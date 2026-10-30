/**
 * Correos de FormsBot: plantilla, correos de servicio (envío terminado,
 * compra, devolución) y el reparto del boletín por lotes.
 *
 * Gmail personal permite ~500 destinatarios al día. El boletín usa como
 * máximo GMAIL_DAILY_LIMIT − 100 (por defecto 350) para que siempre queden
 * correos de servicio disponibles.
 */
import { db } from "./db";
import { siteUrl } from "./config";
import { gmailConfigured, gmailTokenCheck, sendMail } from "./gmail";
import { hasColumn } from "./schemaFlags";
import { noteFailure, suppressionReason } from "./suppression";

const DAILY_LIMIT = Math.max(50, Number(process.env.GMAIL_DAILY_LIMIT) || 450);
const SERVICE_RESERVE = 100;

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

/** Plantilla común (tablas e inline styles: así se ve bien en Gmail y Outlook). */
export function emailLayout(opts: { title: string; bodyHtml: string; cta?: { label: string; url: string }; footerHtml?: string }): string {
  const cta = opts.cta
    ? `<p style="margin:24px 0 8px"><a href="${escapeHtml(opts.cta.url)}" style="display:inline-block;background:#5B2EA6;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px">${escapeHtml(opts.cta.label)}</a></p>`
    : "";
  return `<!doctype html><html lang="es"><body style="margin:0;background:#F4F1FA;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#21163F">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:14px;border-top:6px solid #5B2EA6" cellspacing="0" cellpadding="0"><tr><td style="padding:24px 26px">
<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 14px"><tr><td><img src="${siteUrl()}/email-logo.png" width="40" height="40" alt="FormsBot" style="display:block;border:0;border-radius:10px"></td><td style="padding-left:10px;font-weight:800;font-size:18px;color:#5B2EA6">FormsBot</td></tr></table>
<h1 style="margin:0 0 14px;font-size:21px;line-height:1.3">${escapeHtml(opts.title)}</h1>
<div style="font-size:15px;line-height:1.6;color:#3B3354">${opts.bodyHtml}</div>
${cta}
</td></tr></table>
<p style="max-width:560px;margin:14px auto 0;font-size:12px;line-height:1.5;color:#6B6386">${opts.footerHtml ?? ""}<br>Soporte: <a href="https://t.me/onPowerTec" style="color:#6B6386">Telegram</a> · <a href="mailto:edroservices@gmail.com" style="color:#6B6386">edroservices@gmail.com</a><br>FormsBot · <a href="${siteUrl()}/privacidad.html" style="color:#6B6386">Privacidad</a></p>
</td></tr></table></body></html>`;
}

async function sentLast24h(): Promise<number> {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const supa = db();
  const [service, news] = await Promise.all([
    supa.from("web_email_log").select("id", { count: "exact", head: true }).eq("ok", true).gte("created_at", since),
    supa.from("web_newsletter_sends").select("id", { count: "exact", head: true }).eq("status", "sent").gte("sent_at", since),
  ]);
  return (service.count ?? 0) + (news.count ?? 0);
}

/**
 * Correo de servicio a un usuario (no requiere consentimiento de marketing:
 * es parte del contrato). Nunca lanza: si Gmail no está configurado o falla,
 * queda en web_email_log y la notificación de la campana sigue llegando.
 */
export async function sendServiceEmail(
  userId: string,
  kind: string,
  content: { subject: string; title: string; bodyHtml: string; cta?: { label: string; url: string } }
): Promise<void> {
  const supa = db();
  let email = "";
  const html = emailLayout({
    title: content.title,
    bodyHtml: content.bodyHtml,
    cta: content.cta,
    footerHtml: "Recibes este correo porque usas FormsBot (avisos de tus envíos y compras). ",
  });
  try {
    const { data: u } = await supa.from("web_users").select("email,deleted_at").eq("id", userId).maybeSingle<{ email: string; deleted_at?: string | null }>();
    if (!u?.email || u.deleted_at || u.email.endsWith(".invalid")) return;
    email = u.email;
    // Antes se salía en silencio y nadie sabía por qué no llegaban los correos:
    // ahora queda en el historial (Admin → Newsletter → Historial de correos).
    if (!gmailConfigured()) {
      throw new Error("Gmail no está configurado en el proyecto del servicio (faltan GMAIL_REFRESH_TOKEN / GMAIL_SENDER en Vercel).");
    }
    // Dirección que rebota (buzón lleno, no existe…): no se vuelve a intentar.
    const blocked = await suppressionReason(email);
    if (blocked) {
      await supa.from("web_email_log").insert({ kind, user_id: userId, email, ok: false, error: `No se envía: ${blocked}` });
      return;
    }
    if ((await sentLast24h()) >= DAILY_LIMIT) throw new Error("límite diario de Gmail alcanzado");
    await sendMail({ to: email, subject: content.subject, html });
    await supa.from("web_email_log").insert({ kind, user_id: userId, email, ok: true });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.warn(`[mailer] ${kind} a ${email || userId}: ${error}`);
    await noteFailure(email, error).catch(() => {});
    await supa.from("web_email_log").insert({ kind, user_id: userId, email, ok: false, error: error.slice(0, 300) }).then(
      () => {},
      () => {}
    );
    // Falla nuestra o pasajera (token, configuración, límite del día, red):
    // el correo queda en cola y sale solo cuando Gmail vuelva a funcionar.
    if (email && isRetryable(error)) {
      await supa
        .from("web_email_outbox")
        .insert({ user_id: userId, email, kind, subject: content.subject, html, last_error: error.slice(0, 300) })
        .then(
          () => {},
          () => {}
        );
    }
  }
}

/** Errores que no son culpa de la dirección: vale la pena reintentar más tarde. */
function isRetryable(error: string): boolean {
  if (/no se envía|invalid to|invalid.*address|recipient address rejected|no such user/i.test(error)) return false;
  return /refresh token|oauth|no está configurado|límite diario|limit|quota|rate|timeout|network|fetch failed|ECONN|5\d\d|401|403|429/i.test(error);
}

const OUTBOX_PER_RUN = 6;
const OUTBOX_MAX_AGE_DAYS = 30;

/**
 * Manda la cola de correos pendientes de a pocos (6 por pasada del worker,
 * del más nuevo al más viejo) solo si Gmail ya funciona y sin pasar el
 * límite diario. Los de más de 30 días se descartan.
 */
export async function drainOutbox(deadline = Date.now() + 15_000): Promise<{ sent: number; failed: number } | null> {
  const supa = db();
  const { data: next, error } = await supa
    .from("web_email_outbox")
    .select("id")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error || !next?.length) return null; // sin cola (o falta ronda_30.sql)
  if (!gmailConfigured()) return null;
  const token = await gmailTokenCheck();
  if (!token.ok) return null; // Gmail sigue caído: se espera a la próxima pasada

  await supa
    .from("web_email_outbox")
    .update({ status: "expired" })
    .eq("status", "pending")
    .lt("created_at", new Date(Date.now() - OUTBOX_MAX_AGE_DAYS * 86400_000).toISOString());

  const budget = Math.min(OUTBOX_PER_RUN, DAILY_LIMIT - (await sentLast24h()));
  if (budget <= 0) return { sent: 0, failed: 0 };
  const { data: rows } = await supa
    .from("web_email_outbox")
    .select("id,user_id,email,kind,subject,html,attempts")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(budget);

  const result = { sent: 0, failed: 0 };
  for (const row of (rows ?? []) as { id: number; user_id: string | null; email: string; kind: string; subject: string; html: string; attempts: number }[]) {
    if (Date.now() > deadline) break;
    // Reclamo atómico: dos workers a la vez no mandan el mismo correo.
    const { data: claimed } = await supa.from("web_email_outbox").update({ status: "sending" }).eq("id", row.id).eq("status", "pending").select("id");
    if (!claimed?.length) continue;
    const blocked = await suppressionReason(row.email);
    if (blocked) {
      await supa.from("web_email_outbox").update({ status: "failed", last_error: `No se envía: ${blocked}` }).eq("id", row.id);
      continue;
    }
    try {
      await sendMail({ to: row.email, subject: row.subject, html: row.html });
      await supa.from("web_email_outbox").update({ status: "sent", sent_at: new Date().toISOString(), attempts: row.attempts + 1 }).eq("id", row.id);
      await supa.from("web_email_log").insert({ kind: `${row.kind} (reenviado)`, user_id: row.user_id, email: row.email, ok: true });
      result.sent++;
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      const giveUp = row.attempts + 1 >= 5 || !isRetryable(msg);
      await supa.from("web_email_outbox").update({ status: giveUp ? "failed" : "pending", attempts: row.attempts + 1, last_error: msg }).eq("id", row.id);
      result.failed++;
      if (isRetryable(msg)) break; // Gmail volvió a fallar: se para hasta la próxima pasada
    }
  }
  return result;
}

export function unsubscribeUrl(token: string): string {
  return `${siteUrl()}/baja?t=${encodeURIComponent(token)}`;
}

/**
 * Reparte el boletín en curso: hasta `max` correos por llamada (el worker
 * llama cada minuto). Solo a quien sigue suscrito EN ESTE MOMENTO.
 */
export async function sendNewsletterBatch(max = 15, deadline = Date.now() + 20_000): Promise<{ sent: number; failed: number }> {
  const result = { sent: 0, failed: 0 };
  if (!gmailConfigured()) return result;
  const supa = db();
  const serviceCol = await hasColumn("web_newsletters", "is_service");
  const { data: nl } = await supa
    .from("web_newsletters")
    .select(serviceCol ? "id,subject,body_html,sent_count,failed_count,is_service" : "id,subject,body_html,sent_count,failed_count")
    .eq("status", "sending")
    .order("started_at", { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string; subject: string; body_html: string; sent_count: number; failed_count: number; is_service?: boolean }>();
  if (!nl) return result;

  const budget = Math.min(max, DAILY_LIMIT - SERVICE_RESERVE - (await sentLast24h()));
  if (budget <= 0) return result;

  const { data: pending } = await supa
    .from("web_newsletter_sends")
    .select("id,user_id,email")
    .eq("newsletter_id", nl.id)
    .eq("status", "pending")
    .limit(budget);

  if (!pending?.length) {
    await supa.from("web_newsletters").update({ status: "sent", finished_at: new Date().toISOString() }).eq("id", nl.id).eq("status", "sending");
    return result;
  }

  for (const row of pending) {
    if (Date.now() > deadline) break;
    // Reclamo atómico de la fila: dos workers a la vez no mandan el mismo correo.
    const { data: claimed } = await supa
      .from("web_newsletter_sends")
      .update({ status: "skipped", error: "en curso" })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    const { data: u } = await supa
      .from("web_users")
      .select("email,marketing_opt_in,unsubscribe_token,deleted_at")
      .eq("id", row.user_id)
      .maybeSingle<{ email: string; marketing_opt_in: boolean; unsubscribe_token: string | null; deleted_at: string | null }>();
    // Aviso del servicio: basta con que la cuenta exista. Boletín: solo suscritos.
    const isService = nl.is_service === true;
    const suppressed = u?.email ? await suppressionReason(u.email) : null;
    if (suppressed) {
      await supa.from("web_newsletter_sends").update({ status: "skipped", error: `dirección suspendida: ${suppressed}` }).eq("id", row.id);
      continue;
    }
    if (!u || u.deleted_at || (!isService && (!u.marketing_opt_in || !u.unsubscribe_token))) {
      await supa.from("web_newsletter_sends").update({ status: "skipped", error: "ya no está suscrito" }).eq("id", row.id);
      continue;
    }
    try {
      await sendMail(
        isService
          ? { to: u.email, subject: nl.subject, html: nl.body_html }
          : {
              to: u.email,
              subject: nl.subject,
              html: nl.body_html.split("{{UNSUB_URL}}").join(escapeHtml(unsubscribeUrl(u.unsubscribe_token as string))),
              headers: {
                // Baja con un clic desde Gmail/Outlook (RFC 8058).
                "List-Unsubscribe": `<${siteUrl()}/api/web/unsubscribe?t=${encodeURIComponent(u.unsubscribe_token as string)}>`,
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
              },
            }
      );
      await supa.from("web_newsletter_sends").update({ status: "sent", error: "", sent_at: new Date().toISOString() }).eq("id", row.id);
      result.sent++;
    } catch (e) {
      await supa
        .from("web_newsletter_sends")
        .update({ status: "failed", error: (e instanceof Error ? e.message : String(e)).slice(0, 300) })
        .eq("id", row.id);
      result.failed++;
    }
  }

  if (result.sent || result.failed) {
    const [{ count: sentTotal }, { count: failedTotal }] = await Promise.all([
      supa.from("web_newsletter_sends").select("id", { count: "exact", head: true }).eq("newsletter_id", nl.id).eq("status", "sent"),
      supa.from("web_newsletter_sends").select("id", { count: "exact", head: true }).eq("newsletter_id", nl.id).eq("status", "failed"),
    ]);
    await supa.from("web_newsletters").update({ sent_count: sentTotal ?? 0, failed_count: failedTotal ?? 0 }).eq("id", nl.id);
  }
  return result;
}

/** Fecha y hora legibles (hora de Lima) para los correos. */
export function mailDate(d: Date | string = new Date()): string {
  return new Date(d).toLocaleString("es-PE", { timeZone: "America/Lima", dateStyle: "long", timeStyle: "short" });
}

/** Tabla de resumen (comprobante) para los correos: [etiqueta, valor ya escapado]. */
export function summaryTable(rows: [string, string][]): string {
  const tr = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:8px 10px;border-bottom:1px solid #ECE6F7;color:#6B6386;font-size:13px;white-space:nowrap">${escapeHtml(k)}</td><td style="padding:8px 10px;border-bottom:1px solid #ECE6F7;font-weight:700;font-size:14px">${v}</td></tr>`
    )
    .join("");
  return `<table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="margin:14px 0;border:1px solid #ECE6F7;border-radius:10px;border-collapse:separate">${tr}</table>`;
}
