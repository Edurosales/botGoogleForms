/**
 * Avisos al DUEÑO por correo: compras (siempre) y emergencias (claves de IA
 * caídas, errores de pago…). Las emergencias se limitan a una por tipo cada
 * hora (se recuerda en web_audit_log) para no inundar el correo.
 *
 * Destino: Configuración → "Correo para avisos" (owner_alert_email); si está
 * vacío, OWNER_ALERT_EMAIL, SUPPORT_EMAIL o GMAIL_SENDER.
 */
import { db } from "./db";
import { getAppSettings } from "./appSettings";
import { gmailConfigured, sendMail } from "./gmail";
import { emailLayout, escapeHtml, mailDate, summaryTable } from "./mailer";
import { notifyAdmin } from "./notify";
import { audit } from "./audit";

const NO_REQ = { ip: "", country: "", userAgent: "", path: "" };

async function ownerEmail(): Promise<string> {
  const s = await getAppSettings();
  return (s.owner_alert_email || process.env.OWNER_ALERT_EMAIL || process.env.SUPPORT_EMAIL || process.env.GMAIL_SENDER || "").trim();
}

async function mailOwner(subject: string, title: string, bodyHtml: string): Promise<void> {
  const to = await ownerEmail();
  if (!to || !gmailConfigured()) return;
  await sendMail({ to, subject, html: emailLayout({ title, bodyHtml, footerHtml: "Aviso interno de FormsBot para el administrador. " }) }).catch((e) =>
    console.warn("[alerts] no se pudo avisar al dueño:", e instanceof Error ? e.message : e)
  );
}

/**
 * Emergencia: aviso en la campana del admin + correo, como máximo una vez por
 * hora para la misma `key` (ej. "ai-all-failed").
 */
export async function alertOwner(key: string, title: string, details: Record<string, string>): Promise<void> {
  try {
    const since = new Date(Date.now() - 60 * 60_000).toISOString();
    const { data: recent } = await db()
      .from("web_audit_log")
      .select("id")
      .eq("action", `alert.${key}`)
      .gte("created_at", since)
      .limit(1);
    if (recent?.length) return;
    await audit({ action: `alert.${key}`, level: "error", target: key, details, meta: NO_REQ });
    await notifyAdmin({ kind: "alert", title: `⚠️ ${title}`, body: Object.values(details).join(" · ").slice(0, 400), link: "/admin#logs" });
    await mailOwner(
      `⚠️ FormsBot: ${title}`,
      title,
      summaryTable(Object.entries(details).map(([k, v]) => [k, escapeHtml(v)] as [string, string])) +
        `<p>Fecha: ${escapeHtml(mailDate())}. Revisa el panel (Registros) para más detalle.</p>`
    );
  } catch (e) {
    console.warn(`[alerts] ${key}:`, e instanceof Error ? e.message : e);
  }
}

/** Aviso de compra al dueño (siempre, sin límite). */
export async function notifyOwnerPurchase(info: { email: string; credits: number; amount: string; orderId: string; provider: string }): Promise<void> {
  await mailOwner(
    `💰 Nueva compra: ${info.amount} (${info.credits} créditos)`,
    `Nueva compra de ${info.credits} créditos`,
    summaryTable([
      ["Cliente", escapeHtml(info.email)],
      ["Créditos", String(info.credits)],
      ["Monto", escapeHtml(info.amount)],
      ["Pedido", escapeHtml(info.orderId)],
      ["Medio de pago", escapeHtml(info.provider)],
      ["Fecha", escapeHtml(mailDate())],
    ])
  );
}
