/**
 * Correos que no hay que volver a intentar (buzón lleno, dirección que no
 * existe, rechazo del servidor destino, o marcados a mano en el panel).
 *
 * Cómo entran a la lista:
 * - Rebotes: cada hora se leen los avisos de "Mail Delivery Subsystem" que
 *   llegan al Gmail que envía (necesita el permiso gmail.readonly en el
 *   GMAIL_REFRESH_TOKEN; sin él, este paso se salta sin romper nada).
 * - Fallos seguidos: 3 envíos fallidos seguidos a la misma dirección.
 * - A mano: Admin → Newsletter → Historial de correos → "No enviar más".
 */
import { db } from "./db";
import { accessToken, gmailConfigured } from "./gmail";
import { audit } from "./audit";

const NO_REQ = { ip: "", country: "", userAgent: "", path: "" };

export async function suppressionReason(email: string): Promise<string | null> {
  const { data, error } = await db().from("web_email_suppressions").select("reason").eq("email", email.toLowerCase()).maybeSingle<{ reason: string }>();
  if (error || !data) return null;
  return data.reason || "dirección suspendida";
}

export async function suppress(email: string, reason: string, source: "bounce" | "failures" | "manual"): Promise<void> {
  const e = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return;
  await db()
    .from("web_email_suppressions")
    .upsert({ email: e, reason: reason.slice(0, 300), source }, { onConflict: "email" })
    .then(
      () => {},
      () => {}
    );
  await audit({ action: "email.suppressed", level: "warn", email: e, details: { reason, source }, meta: NO_REQ });
}

// Errores nuestros (configuración, límite diario): no son culpa de la dirección.
const OUR_FAULT = /no está configurado|límite diario|GMAIL_REFRESH_TOKEN|invalid_grant|token/i;

/** Tras un fallo: si es el 3.º seguido a esa dirección, se suspende. */
export async function noteFailure(email: string, error: string): Promise<void> {
  if (!email || OUR_FAULT.test(error)) return;
  const { data } = await db()
    .from("web_email_log")
    .select("ok,error")
    .eq("email", email.toLowerCase())
    .order("created_at", { ascending: false })
    .limit(3);
  const rows = data ?? [];
  if (rows.length === 3 && rows.every((r) => !r.ok && !OUR_FAULT.test(String(r.error ?? "")))) {
    await suppress(email, `3 envíos fallidos seguidos: ${error}`, "failures");
  }
}

type GmailList = { messages?: { id: string }[] };
type GmailMsg = { id: string; snippet?: string; payload?: { headers?: { name: string; value: string }[] } };

/** Motivo legible a partir del texto del rebote. */
function bounceReason(text: string): string {
  const t = text.toLowerCase();
  if (/inbox is full|mailbox is full|over quota|quota exceeded|buzón.*lleno|insufficient storage|out of storage/.test(t)) return "Buzón lleno";
  if (/does not exist|no such user|user unknown|address not found|couldn't be found|no existe/.test(t)) return "La dirección no existe";
  if (/blocked|rejected|policy|spam/.test(t)) return "El servidor destino rechaza los correos";
  return "Rebote del servidor destino";
}

/**
 * Lee los rebotes recientes en el Gmail que envía y suspende esas
 * direcciones. Lo llama el worker como máximo una vez por hora.
 */
export async function scanBounces(): Promise<{ checked: number; suppressed: number; skipped?: string }> {
  const out = { checked: 0, suppressed: 0 };
  if (!gmailConfigured()) return { ...out, skipped: "gmail no configurado" };
  const supa = db();
  const since = new Date(Date.now() - 55 * 60_000).toISOString();
  const { data: recent } = await supa.from("web_audit_log").select("id").eq("action", "email.bounce_scan").gte("created_at", since).limit(1);
  if (recent?.length) return { ...out, skipped: "ya se revisó hace poco" };

  let token: string;
  try {
    token = await accessToken();
  } catch (e) {
    return { ...out, skipped: e instanceof Error ? e.message : "sin token" };
  }
  const api = (path: string) =>
    fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });

  const q = encodeURIComponent("from:(mailer-daemon OR postmaster) newer_than:7d");
  const listRes = await api(`messages?q=${q}&maxResults=50`);
  if (listRes.status === 403) {
    await audit({ action: "email.bounce_scan", level: "info", details: { skipped: "el token no tiene permiso de lectura (gmail.readonly)" }, meta: NO_REQ });
    return { ...out, skipped: "sin permiso gmail.readonly" };
  }
  if (!listRes.ok) return { ...out, skipped: `Gmail ${listRes.status}` };
  const list = (await listRes.json()) as GmailList;

  for (const m of list.messages ?? []) {
    const { data: seen } = await supa.from("web_email_bounces_seen").select("message_id").eq("message_id", m.id).maybeSingle();
    if (seen) continue;
    out.checked++;
    const r = await api(`messages/${m.id}?format=metadata&metadataHeaders=X-Failed-Recipients&metadataHeaders=Subject`);
    if (r.ok) {
      const msg = (await r.json()) as GmailMsg;
      const failed = msg.payload?.headers?.find((h) => h.name.toLowerCase() === "x-failed-recipients")?.value ?? "";
      const subject = msg.payload?.headers?.find((h) => h.name.toLowerCase() === "subject")?.value ?? "";
      const reason = bounceReason(`${subject} ${msg.snippet ?? ""}`);
      for (const addr of failed.split(",").map((x) => x.trim()).filter(Boolean)) {
        await suppress(addr, reason, "bounce");
        out.suppressed++;
      }
    }
    await supa.from("web_email_bounces_seen").insert({ message_id: m.id }).then(
      () => {},
      () => {}
    );
  }
  await audit({ action: "email.bounce_scan", level: "info", details: out, meta: NO_REQ });
  return out;
}
