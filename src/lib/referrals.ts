/**
 * Programa de referidos ("Invita y gana") y aviso de pocos créditos.
 *
 * Referidos, de punta a punta:
 *   1. Cada cliente tiene un código (web_users.referral_code) y un enlace /r/CODIGO.
 *   2. /r/CODIGO guarda el código en una cookie httpOnly (30 días) y manda a la portada.
 *   3. Al CREAR la cuenta (nunca en un inicio de sesión) se liga al invitador
 *      (attachReferral), con controles: no a sí mismo, no misma IP de registro,
 *      no correos que ya tuvieron cuenta, no invitadores borrados o bloqueados.
 *   4. En la primera compra pagada del invitado que llegue al monto mínimo,
 *      web_referral_reward (SQL, atómico) suma créditos a los dos.
 *   5. Si esa compra se devuelve, un trigger retira el premio (web_referral_reverse).
 * Las cantidades se configuran en Admin → Configuración. Nada de esto se
 * decide en el navegador.
 */
import { randomInt } from "node:crypto";
import { db } from "./db";
import { getAppSettings } from "./appSettings";
import { notifyAdmin, notifyUser } from "./notify";
import { audit } from "./audit";
import { emailHash } from "./googleAuth";
import { escapeHtml, sendServiceEmail, summaryTable } from "./mailer";
import { siteUrl } from "./config";

const NO_REQ = { ip: "", country: "", userAgent: "", path: "" };
export const REFERRAL_COOKIE = "fb_ref";
export const REFERRAL_COOKIE_DAYS = 30;
/** Sin 0/O ni 1/I/L: se dictan y se copian sin confusiones. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_RE = /^[A-HJKMNP-Z2-9]{8}$/;

export function normalizeCode(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const c = v.trim().toUpperCase();
  return CODE_RE.test(c) ? c : null;
}

function newCode(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

/** Código del usuario; lo crea la primera vez (reintenta si choca con otro). */
export async function ensureReferralCode(userId: string): Promise<string | null> {
  const supa = db();
  const { data: u, error } = await supa.from("web_users").select("referral_code").eq("id", userId).maybeSingle<{ referral_code: string | null }>();
  if (error) return null; // falta ronda_29.sql
  if (u?.referral_code) return u.referral_code;
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    // Solo si aún no tiene: dos pestañas a la vez no le cambian el código.
    const { data, error: upErr } = await supa
      .from("web_users")
      .update({ referral_code: code })
      .eq("id", userId)
      .is("referral_code", null)
      .select("referral_code")
      .maybeSingle<{ referral_code: string }>();
    if (data?.referral_code) return data.referral_code;
    if (!upErr) {
      // Otra petición lo creó primero: se usa ese.
      const { data: again } = await supa.from("web_users").select("referral_code").eq("id", userId).maybeSingle<{ referral_code: string | null }>();
      if (again?.referral_code) return again.referral_code;
    }
  }
  return null;
}

export async function referrerExists(code: string): Promise<boolean> {
  const { data } = await db().from("web_users").select("id,deleted_at").eq("referral_code", code).maybeSingle<{ id: string; deleted_at: string | null }>();
  return Boolean(data && !data.deleted_at);
}

/**
 * Liga una cuenta recién creada con quien la invitó. Nunca rompe el registro:
 * ante cualquier problema solo se registra. Los casos dudosos quedan como
 * "rejected" con el motivo, para que el admin los vea.
 */
export async function attachReferral(newUser: { id: string; email: string; signupIp: string }, rawCode: string | undefined): Promise<void> {
  const code = normalizeCode(rawCode);
  if (!code) return;
  try {
    const settings = await getAppSettings();
    if (!settings.referral_enabled) return;
    const supa = db();
    const { data: inviter } = await supa.from("web_users").select("*").eq("referral_code", code).maybeSingle<Record<string, unknown>>();
    if (!inviter || inviter.deleted_at) return;

    let reason = "";
    const inviterEmail = String(inviter.email ?? "").toLowerCase();
    if (inviter.id === newUser.id || inviterEmail === newUser.email.toLowerCase()) reason = "Se invitó a sí mismo";
    else if (inviter.banned_at) reason = "Quien invitó está bloqueado";
    else if (newUser.signupIp && String(inviter.signup_ip ?? "") === newUser.signupIp) reason = "Misma conexión (IP) que quien invitó";
    else {
      const { data: wasDeleted } = await supa.from("web_deleted_accounts").select("email_hash").eq("email_hash", emailHash(newUser.email)).maybeSingle();
      if (wasDeleted) reason = "Ese correo ya tuvo una cuenta antes";
    }
    if (!reason) {
      // Otra cuenta registrada desde la misma IP ya fue invitada por la misma persona.
      const { data: sameIp } = newUser.signupIp
        ? await supa.from("web_users").select("id").eq("referred_by", inviter.id as string).eq("signup_ip", newUser.signupIp).neq("id", newUser.id).limit(1)
        : { data: [] };
      if (sameIp?.length) reason = "Varias cuentas invitadas desde la misma conexión";
    }

    const { error } = await supa.from("web_referrals").insert({
      referrer_id: inviter.id,
      referred_id: newUser.id,
      status: reason ? "rejected" : "pending",
      reason,
    });
    if (error) return;
    if (!reason) {
      await supa.from("web_users").update({ referred_by: inviter.id }).eq("id", newUser.id).is("referred_by", null);
      await notifyUser(inviter.id as string, {
        kind: "gift",
        title: "Alguien se registró con tu enlace",
        body: "Cuando haga su primera compra, los dos reciben créditos.",
        link: "/invita",
      });
    }
    await audit({
      action: reason ? "referral.rejected" : "referral.attached",
      level: reason ? "security" : "info",
      userId: newUser.id,
      email: newUser.email,
      target: code,
      details: { referrer_id: inviter.id, reason },
      meta: NO_REQ,
    });
  } catch (e) {
    console.error("[referrals] attach:", e instanceof Error ? e.message : e);
  }
}

/** Tras acreditar una compra pagada: premio de referido si corresponde. */
export async function rewardReferral(order: { user_id: string; order_id: string }): Promise<void> {
  try {
    const s = await getAppSettings();
    if (!s.referral_enabled) return;
    const { data, error } = await db().rpc("web_referral_reward", {
      p_referred: order.user_id,
      p_order: order.order_id,
      p_min_cents: s.referral_min_purchase_cents ?? 1500,
      p_ref_credits: s.referral_reward_referrer ?? 20,
      p_new_credits: s.referral_reward_referred ?? 10,
      p_month_cap: s.referral_monthly_cap ?? 20,
    });
    if (error) return;
    const row = (Array.isArray(data) ? data[0] : data) as { status: string; referrer_id: string; referrer_credits: number; referred_credits: number } | null;
    if (!row) return;

    if (row.referred_credits > 0) {
      await notifyUser(order.user_id, {
        kind: "gift",
        title: `+${row.referred_credits} créditos de regalo`,
        body: "Por tu primera compra con una invitación. ¡Gracias por sumarte!",
        link: "/mi-cuenta",
      });
    }
    if (row.referrer_credits > 0) {
      await notifyUser(row.referrer_id, {
        kind: "gift",
        title: `Ganaste ${row.referrer_credits} créditos`,
        body: "Una persona que invitaste hizo su primera compra.",
        link: "/invita",
      });
      await sendServiceEmail(row.referrer_id, "referral", {
        subject: `Ganaste ${row.referrer_credits} créditos en FormsBot`,
        title: `¡+${row.referrer_credits} créditos por invitar!`,
        bodyHtml:
          `<p>Una persona que invitaste con tu enlace hizo su primera compra. Ya sumamos tus créditos.</p>` +
          summaryTable([
            ["Créditos ganados", `+${row.referrer_credits}`],
            ["Pedido del invitado", escapeHtml(order.order_id)],
          ]) +
          `<p>Sigue compartiendo tu enlace desde <strong>Invita y gana</strong>.</p>`,
        cta: { label: "Ver mis invitaciones", url: `${siteUrl()}/invita` },
      });
    } else if (row.status === "capped") {
      await notifyUser(row.referrer_id, {
        kind: "gift",
        title: "Llegaste al tope de premios del mes",
        body: "Tu invitado compró, pero este mes ya ganaste el máximo. Se reinicia el día 1.",
        link: "/invita",
      });
    }
    await notifyAdmin({
      kind: "gift",
      title: `Referido premiado (${row.status})`,
      body: `Pedido ${order.order_id}: +${row.referrer_credits} a quien invitó, +${row.referred_credits} al invitado.`,
      link: "/admin#referidos",
    });
    await audit({ action: "referral.reward", userId: order.user_id, target: order.order_id, details: row, meta: NO_REQ });
  } catch (e) {
    console.error("[referrals] reward:", e instanceof Error ? e.message : e);
  }
}

/** "c***s@gmail.com": quien invita ve a quién trajo sin exponer su correo completo. */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return "—";
  return `${user[0]}${"*".repeat(Math.max(2, Math.min(6, user.length - 2)))}${user.length > 1 ? user[user.length - 1] : ""}@${domain}`;
}

const pen = (c: number) => `S/ ${(c / 100).toFixed(2)}`;

/**
 * Aviso de pocos créditos: a clientes que compraron en los últimos 180 días
 * y cuyo saldo bajó del umbral. Una vez por cada compra (se vuelve a avisar
 * solo después de una nueva compra). Desde el worker, cada 30 min como mucho.
 */
export async function lowCreditsAlerts(): Promise<{ sent: number } | null> {
  const s = await getAppSettings();
  if (s.low_credits_enabled === false) return null;
  const threshold = s.low_credits_threshold ?? 20;
  const supa = db();
  const since30m = new Date(Date.now() - 30 * 60_000).toISOString();
  const { data: ran, error: ranErr } = await supa.from("web_audit_log").select("id").eq("action", "credits.low_scan").gte("created_at", since30m).limit(1);
  if (ranErr || ran?.length) return null;
  await audit({ action: "credits.low_scan", meta: NO_REQ });

  const { data: paid } = await supa
    .from("web_credit_orders")
    .select("user_id,paid_at,credits,amount_cents")
    .eq("status", "paid")
    .gte("paid_at", new Date(Date.now() - 180 * 86400_000).toISOString())
    .order("paid_at", { ascending: false })
    .limit(5000);
  const last = new Map<string, { paid_at: string; credits: number; amount_cents: number }>();
  for (const o of (paid ?? []) as { user_id: string; paid_at: string; credits: number; amount_cents: number }[]) {
    if (!last.has(o.user_id)) last.set(o.user_id, o);
  }
  if (!last.size) return { sent: 0 };

  const ids = [...last.keys()];
  let sent = 0;
  for (let i = 0; i < ids.length && sent < 30; i += 200) {
    const { data: users, error } = await supa
      .from("web_users")
      .select("id,credits,low_credits_notified_at,deleted_at")
      .in("id", ids.slice(i, i + 200))
      .lt("credits", threshold);
    if (error) return null; // falta ronda_29.sql
    for (const u of (users ?? []) as { id: string; credits: number; low_credits_notified_at: string | null; deleted_at: string | null }[]) {
      if (sent >= 30) break;
      const lastBuy = last.get(u.id)!;
      if (u.deleted_at) continue;
      if (u.low_credits_notified_at && Date.parse(u.low_credits_notified_at) >= Date.parse(lastBuy.paid_at)) continue;
      // Reclamo atómico: si dos workers coinciden, solo uno avisa.
      const { data: claimed } = await supa
        .from("web_users")
        .update({ low_credits_notified_at: new Date().toISOString() })
        .eq("id", u.id)
        .or(`low_credits_notified_at.is.null,low_credits_notified_at.lt."${new Date(lastBuy.paid_at).toISOString()}"`)
        .select("id");
      if (!claimed?.length) continue;

      // El paquete que suele comprar, ya elegido en la tienda.
      const idx = s.credit_packages.findIndex((p) => p.responses === lastBuy.credits);
      const link = `/comprar-creditos${idx >= 0 ? `?paquete=${idx}` : ""}`;
      const pack = idx >= 0 ? s.credit_packages[idx] : null;
      await notifyUser(u.id, {
        kind: "credits",
        title: u.credits > 0 ? `Te quedan ${u.credits} créditos` : "Te quedaste sin créditos",
        body: pack ? `Recarga ${pack.responses} créditos por ${pen(pack.priceCents)} en un clic.` : "Recarga para tu próximo envío.",
        link,
      });
      await sendServiceEmail(u.id, "low_credits", {
        subject: u.credits > 0 ? `Te quedan ${u.credits} créditos en FormsBot` : "Te quedaste sin créditos en FormsBot",
        title: u.credits > 0 ? `Te quedan ${u.credits} créditos` : "Te quedaste sin créditos",
        bodyHtml:
          `<p>Para que tu próxima prueba no se quede a medias, recarga antes de empezar.</p>` +
          (pack ? summaryTable([["Tu paquete de siempre", `${pack.responses} créditos`], ["Precio", escapeHtml(pen(pack.priceCents))]]) : "") +
          `<p style="font-size:12px;color:#6B6386">Te avisamos una sola vez por compra. Puedes dejar de recibir estos avisos escribiéndonos.</p>`,
        cta: { label: "Recargar créditos", url: `${siteUrl()}${link}` },
      });
      await audit({ action: "credits.low_notice", userId: u.id, details: { credits: u.credits, threshold }, meta: NO_REQ });
      sent++;
    }
  }
  return { sent };
}
