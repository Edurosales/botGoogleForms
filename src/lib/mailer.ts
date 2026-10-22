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
import { gmailConfigured, sendMail } from "./gmail";

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
<p style="margin:0 0 6px;font-weight:800;font-size:18px;color:#5B2EA6">FormsBot</p>
<h1 style="margin:0 0 14px;font-size:21px;line-height:1.3">${escapeHtml(opts.title)}</h1>
<div style="font-size:15px;line-height:1.6;color:#3B3354">${opts.bodyHtml}</div>
${cta}
</td></tr></table>
<p style="max-width:560px;margin:14px auto 0;font-size:12px;line-height:1.5;color:#6B6386">${opts.footerHtml ?? ""}FormsBot · <a href="${siteUrl()}/privacidad.html" style="color:#6B6386">Privacidad</a></p>
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
  if (!gmailConfigured()) return;
  const supa = db();
  let email = "";
  try {
    const { data: u } = await supa.from("web_users").select("email,deleted_at").eq("id", userId).maybeSingle<{ email: string; deleted_at?: string | null }>();
    if (!u?.email || u.deleted_at || u.email.endsWith(".invalid")) return;
    email = u.email;
    if ((await sentLast24h()) >= DAILY_LIMIT) throw new Error("límite diario de Gmail alcanzado");
    await sendMail({
      to: email,
      subject: content.subject,
      html: emailLayout({
        title: content.title,
        bodyHtml: content.bodyHtml,
        cta: content.cta,
        footerHtml: "Recibes este correo porque usas FormsBot (avisos de tus envíos y compras). ",
      }),
    });
    await supa.from("web_email_log").insert({ kind, user_id: userId, email, ok: true });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.warn(`[mailer] ${kind} a ${email || userId}: ${error}`);
    await supa.from("web_email_log").insert({ kind, user_id: userId, email, ok: false, error: error.slice(0, 300) }).then(
      () => {},
      () => {}
    );
  }
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
  const { data: nl } = await supa
    .from("web_newsletters")
    .select("id,subject,body_html,sent_count,failed_count")
    .eq("status", "sending")
    .order("started_at", { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string; subject: string; body_html: string; sent_count: number; failed_count: number }>();
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
    if (!u || !u.marketing_opt_in || u.deleted_at || !u.unsubscribe_token) {
      await supa.from("web_newsletter_sends").update({ status: "skipped", error: "ya no está suscrito" }).eq("id", row.id);
      continue;
    }
    const unsub = unsubscribeUrl(u.unsubscribe_token);
    try {
      await sendMail({
        to: u.email,
        subject: nl.subject,
        html: nl.body_html.split("{{UNSUB_URL}}").join(escapeHtml(unsub)),
        headers: {
          // Baja con un clic desde Gmail/Outlook (RFC 8058).
          "List-Unsubscribe": `<${siteUrl()}/api/web/unsubscribe?t=${encodeURIComponent(u.unsubscribe_token)}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });
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
