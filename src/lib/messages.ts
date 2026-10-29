/**
 * Mensajes con soporte (chat del botón "Soporte") y seguimiento automático de
 * pagos que no se completaron.
 *
 * Quién puede escribir: cuentas que intentaron comprar (tienen algún pedido,
 * pagado o no) o a las que el dueño ya les escribió. El resto ve el chat pero
 * solo con WhatsApp/Telegram/correo. Tope: 2 mensajes por día, 500
 * caracteres (aplicado en la base: web_send_user_message, ronda_27.sql).
 */
import { db } from "./db";
import { notifyAdmin, notifyUser } from "./notify";
import { audit } from "./audit";
import { notifyOwnerMessage } from "./alerts";
import { randomBytes } from "node:crypto";
import { escapeHtml, sendServiceEmail, summaryTable } from "./mailer";
import { siteUrl } from "./config";

export const USER_MSG_MAX_CHARS = 500;
export const USER_MSG_PER_DAY = 2;

export type ChatMessage = { id: number; sender: "user" | "admin" | "system"; body: string; created_at: string; read_at: string | null };

/** Una conversación se cierra sola tras 24 h sin mensajes; la siguiente empieza de cero. */
export const CONVERSATION_GAP_MS = 24 * 3600_000;

export type PastConversation = { startedAt: string; endedAt: string; count: number; preview: string; messages: ChatMessage[] };

/**
 * Separa los mensajes (de más viejo a más nuevo) en conversaciones: un hueco
 * de 24 h o más cierra la anterior. La actual es la última solo si su último
 * mensaje tiene menos de 24 h; si no, también va a "Chats anteriores".
 */
export function splitConversations(all: ChatMessage[], now = Date.now()): { current: ChatMessage[]; previous: PastConversation[] } {
  const groups: ChatMessage[][] = [];
  for (const m of all) {
    const last = groups.at(-1);
    const prev = last?.at(-1);
    if (last && prev && Date.parse(m.created_at) - Date.parse(prev.created_at) < CONVERSATION_GAP_MS) last.push(m);
    else groups.push([m]);
  }
  const tail = groups.at(-1);
  const open = tail && now - Date.parse(tail.at(-1)!.created_at) < CONVERSATION_GAP_MS;
  const current = open ? (groups.pop() as ChatMessage[]) : [];
  const previous = groups
    .reverse()
    .map((g) => ({
      startedAt: g[0].created_at,
      endedAt: g.at(-1)!.created_at,
      count: g.length,
      preview: (g.find((m) => m.sender === "user") ?? g[0]).body.slice(0, 90),
      messages: g,
    }));
  return { current, previous };
}

const NO_REQ = { ip: "", country: "", userAgent: "", path: "" };
const pen = (c: number) => `S/ ${(c / 100).toFixed(2)}`;

/** Quita caracteres de control (salvo saltos de línea) y espacios de más. */
export function cleanMessage(v: unknown): string {
  if (typeof v !== "string") return "";
  return v
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F​-‏‪-‮⁦-⁩]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function canMessage(userId: string): Promise<boolean> {
  const supa = db();
  const [orders, fromUs] = await Promise.all([
    supa.from("web_credit_orders").select("id", { count: "exact", head: true }).eq("user_id", userId),
    supa.from("web_messages").select("id", { count: "exact", head: true }).eq("user_id", userId).neq("sender", "user"),
  ]);
  return (orders.count ?? 0) > 0 || (fromUs.count ?? 0) > 0;
}

export async function sentToday(userId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count } = await db()
    .from("web_messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("sender", "user")
    .gte("created_at", since);
  return count ?? 0;
}

export async function thread(userId: string): Promise<ChatMessage[]> {
  const { data, error } = await db()
    .from("web_messages")
    .select("id,sender,body,created_at,read_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) return [];
  return ((data ?? []) as ChatMessage[]).reverse();
}

/** Mensaje del cliente (tope diario en la base). null = llegó al tope. */
export async function sendUserMessage(user: { id: string; email: string }, body: string): Promise<number | null> {
  const { data, error } = await db().rpc("web_send_user_message", { p_user: user.id, p_body: body, p_max_per_day: USER_MSG_PER_DAY });
  if (error) throw new Error(error.message);
  const id = typeof data === "number" ? data : data ? Number(data) : null;
  if (!id) return null;
  await notifyAdmin({
    kind: "message",
    title: `💬 Mensaje de ${user.email}`,
    body: body.slice(0, 300),
    link: `/admin#mensajes`,
  });
  // Correo al dueño (el tope de 2 por día ya limita cuántos llegan).
  await notifyOwnerMessage({ email: user.email, body }).catch(() => {});
  await audit({ action: "message.user", userId: user.id, email: user.email, target: String(id), details: { chars: body.length } });
  return id;
}

/**
 * Aviso automático a quien intentó pagar y no terminó (rechazado o
 * abandonado hace más de 30 min), una vez por pedido y como máximo uno por
 * persona cada 24 h. No se avisa si después pagó otro pedido. Se llama desde
 * el worker; corre como mucho cada 10 min (se recuerda en web_audit_log).
 */
export async function paymentFollowUps(): Promise<{ sent: number } | null> {
  const supa = db();
  const since10 = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data: ran, error: ranErr } = await supa.from("web_audit_log").select("id").eq("action", "payments.followup_scan").gte("created_at", since10).limit(1);
  if (ranErr || ran?.length) return null;
  await audit({ action: "payments.followup_scan", meta: NO_REQ });

  const now = Date.now();
  const { data: orders, error } = await supa
    .from("web_credit_orders")
    .select("id,order_id,user_id,credits,amount_cents,status,created_at")
    .is("followup_at", null)
    .in("status", ["pending", "failed"])
    .gte("created_at", new Date(now - 3 * 86400_000).toISOString())
    .lte("created_at", new Date(now - 30 * 60_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return null; // columna followup_at sin crear: falta ronda_27.sql
  type O = { id: string; order_id: string; user_id: string; credits: number; amount_cents: number; status: string; created_at: string };
  const byUser = new Map<string, O[]>();
  for (const o of (orders ?? []) as O[]) byUser.set(o.user_id, [...(byUser.get(o.user_id) ?? []), o]);

  let sent = 0;
  for (const [userId, list] of byUser) {
    if (sent >= 20) break;
    const newest = list[0];
    const ids = list.map((o) => o.id);
    const [{ count: paidAfter }, { count: recent }, { data: user }] = await Promise.all([
      supa.from("web_credit_orders").select("id", { count: "exact", head: true }).eq("user_id", userId).in("status", ["paid", "refunded"]).gt("created_at", newest.created_at),
      supa.from("web_messages").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("sender", "system").gte("created_at", new Date(now - 86400_000).toISOString()),
      supa.from("web_users").select("*").eq("id", userId).maybeSingle<{ name: string; deleted_at: string | null; banned_at?: string | null }>(),
    ]);
    // Se reclaman de forma atómica (solo los que siguen sin marcar): si dos
    // workers corren a la vez, solo uno avisa. Se marcan aunque no se avise,
    // para no revisarlos otra vez.
    const { data: claimed } = await supa
      .from("web_credit_orders")
      .update({ followup_at: new Date().toISOString() })
      .in("id", ids)
      .is("followup_at", null)
      .select("id");
    if (!claimed?.length) continue;
    if ((paidAfter ?? 0) > 0 || (recent ?? 0) > 0 || !user || user.deleted_at || user.banned_at) continue;

    const first = (user.name || "").trim().split(/\s+/)[0];
    const state = newest.status === "failed" ? "fue rechazado" : "quedó sin completar";
    const body =
      `Hola${first ? ` ${first}` : ""}, vimos que tu pago de ${pen(newest.amount_cents)} (${newest.credits} créditos, pedido ${newest.order_id}) ${state}. ` +
      `¿No pudiste hacer el pago? Escríbeme un mensaje por aquí y te ayudo. Si ya pagaste, no te preocupes: los créditos se suman solos cuando llega la confirmación.`;
    const { error: insErr } = await supa.from("web_messages").insert({ user_id: userId, sender: "system", body, order_id: newest.order_id });
    if (insErr) continue;
    await notifyUser(userId, {
      kind: "message",
      title: newest.status === "failed" ? "Tu pago fue rechazado: ¿te ayudamos?" : "Tu pago quedó pendiente: ¿te ayudamos?",
      body: "Abre Soporte → Mensajes y escríbenos. Respondemos por aquí mismo.",
      link: "/mi-cuenta?chat=1",
    });
    await audit({ action: "payments.followup", userId, target: newest.order_id, details: { status: newest.status }, meta: NO_REQ });
    sent++;
  }
  return { sent };
}

export const RECOVERY_PERCENT = 10;
const COUPON_TERMS = "Es de un solo uso, solo para tu cuenta e intransferible; no se acumula con otros cupones ni se canjea por dinero.";
const RECOVERY_HOURS = 72;

/**
 * Cupón de "termina tu compra": a quien dejó un pago rechazado o sin completar
 * hace 24 h (y no pagó después), un cupón de 10 % solo para su correo, de un
 * uso, intransferible y válido 72 h. UNA sola vez en la vida de la cuenta
 * (web_users.recovery_coupon_at). Corre desde el worker como mucho cada 30 min.
 */
export async function paymentRecovery(): Promise<{ sent: number } | null> {
  const supa = db();
  const since30m = new Date(Date.now() - 30 * 60_000).toISOString();
  const { data: ran, error: ranErr } = await supa.from("web_audit_log").select("id").eq("action", "payments.recovery_scan").gte("created_at", since30m).limit(1);
  if (ranErr || ran?.length) return null;
  await audit({ action: "payments.recovery_scan", meta: NO_REQ });

  const now = Date.now();
  // Entre 24 h y 46 h: los pendientes se borran solos a las 48 h.
  const { data: orders, error } = await supa
    .from("web_credit_orders")
    .select("id,order_id,user_id,credits,amount_cents,status,created_at")
    .is("recovery_at", null)
    .in("status", ["pending", "failed"])
    .gte("created_at", new Date(now - 46 * 3600_000).toISOString())
    .lte("created_at", new Date(now - 24 * 3600_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return null; // falta ronda_28.sql
  type O = { id: string; order_id: string; user_id: string; credits: number; amount_cents: number; status: string; created_at: string };
  const byUser = new Map<string, O[]>();
  for (const o of (orders ?? []) as O[]) byUser.set(o.user_id, [...(byUser.get(o.user_id) ?? []), o]);

  let sent = 0;
  for (const [userId, list] of byUser) {
    if (sent >= 15) break;
    const newest = list[0];
    // Reclamo atómico: si dos workers corren a la vez, solo uno manda el cupón.
    const { data: claimed } = await supa
      .from("web_credit_orders")
      .update({ recovery_at: new Date().toISOString() })
      .in("id", list.map((o) => o.id))
      .is("recovery_at", null)
      .select("id");
    if (!claimed?.length) continue;

    const { data: user } = await supa.from("web_users").select("*").eq("id", userId).maybeSingle<Record<string, unknown>>();
    const email = String(user?.email ?? "");
    if (!user || user.deleted_at || user.banned_at || user.purchases_blocked || !email || email.endsWith(".invalid")) continue;
    const [{ count: paidAfter }, { count: recentCoupon }] = await Promise.all([
      supa.from("web_credit_orders").select("id", { count: "exact", head: true }).eq("user_id", userId).in("status", ["paid", "refunded"]).gt("created_at", newest.created_at),
      supa
        .from("web_coupons")
        .select("id", { count: "exact", head: true })
        .like("code", "VUELVE-%")
        .eq("allowed_email", email),
    ]);
    if ((paidAfter ?? 0) > 0 || (recentCoupon ?? 0) > 0) continue;
    // Una sola vez en la vida de la cuenta: se reclama de forma atómica.
    const { data: once, error: onceErr } = await supa
      .from("web_users")
      .update({ recovery_coupon_at: new Date().toISOString() })
      .eq("id", userId)
      .is("recovery_coupon_at", null)
      .select("id");
    if (onceErr || !once?.length) continue;

    const code = `VUELVE-${randomBytes(4).toString("hex").toUpperCase()}`;
    const expires = new Date(now + RECOVERY_HOURS * 3600_000);
    const { error: cErr } = await supa.from("web_coupons").insert({
      code,
      description: `Recuperación de pago (pedido ${newest.order_id})`,
      credits: 0,
      discount_percent: RECOVERY_PERCENT,
      max_uses: 1,
      allowed_email: email,
      expires_at: expires.toISOString(),
      is_active: true,
    });
    if (cErr) continue;

    const until = expires.toLocaleString("es-PE", { timeZone: "America/Lima", dateStyle: "long", timeStyle: "short" });
    await supa.from("web_messages").insert({
      user_id: userId,
      sender: "system",
      body: `Te guardamos un ${RECOVERY_PERCENT}% de descuento para terminar tu compra: usa el cupón ${code} al pagar (válido hasta el ${until}). ${COUPON_TERMS} Si algo falló al pagar, escríbenos aquí.`,
      order_id: newest.order_id,
    });
    await notifyUser(userId, {
      kind: "gift",
      title: `Tienes ${RECOVERY_PERCENT}% de descuento para terminar tu compra`,
      body: `Cupón ${code}: un solo uso, solo para tu cuenta, válido 72 h.`,
      link: `/comprar-creditos?cupon=${code}`,
    });
    await sendServiceEmail(userId, "recovery", {
      subject: `Tu ${RECOVERY_PERCENT}% de descuento en FormsBot te espera`,
      title: `Termina tu compra con ${RECOVERY_PERCENT}% de descuento`,
      bodyHtml:
        `<p>Vimos que tu pago de ${escapeHtml(pen(newest.amount_cents))} (${newest.credits} créditos) no se completó. Te guardamos un descuento:</p>` +
        summaryTable([
          ["Cupón", `<strong>${escapeHtml(code)}</strong>`],
          ["Descuento", `${RECOVERY_PERCENT}%`],
          ["Válido hasta", escapeHtml(until)],
          ["Uso", "Una sola compra, solo con tu cuenta"],
        ]) +
        `<p>Escríbelo en "Cupón" al elegir tu paquete. Si el pago te dio un error, respóndenos desde Mensajes en la página y te ayudamos.</p>` +
        `<p style="font-size:12px;color:#6B6386">Condiciones: cupón personal e intransferible, de un solo uso, válido solo para la cuenta ${escapeHtml(email)} y hasta la fecha indicada; ` +
        `se aplica a un paquete de créditos; no es acumulable con otros cupones, no se canjea por dinero ni se reemplaza si vence. Se ofrece una sola vez por cuenta. ` +
        `<a href="${siteUrl()}/terminos-herramienta.html#cupones" style="color:#6B6386">Términos completos</a>.</p>`,
      cta: { label: "Terminar mi compra", url: `${siteUrl()}/comprar-creditos?cupon=${code}` },
    });
    await audit({ action: "payments.recovery", userId, target: newest.order_id, details: { code }, meta: NO_REQ });
    sent++;
  }
  return { sent };
}
