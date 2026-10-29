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

export const USER_MSG_MAX_CHARS = 500;
export const USER_MSG_PER_DAY = 2;

export type ChatMessage = { id: number; sender: "user" | "admin" | "system"; body: string; created_at: string; read_at: string | null };

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
    .limit(50);
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
