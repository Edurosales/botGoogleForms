/**
 * Vigilancia de la cuenta de cobro. El dinero va a la cuenta dueña de las
 * credenciales guardadas en Vercel (MP_ACCESS_TOKEN, IZIPAY_USERNAME). Si
 * alguien las cambiara por las suyas, los pagos seguirían apareciendo en el
 * panel pero el dinero iría a otro lado. Aquí se toma una "huella" de esas
 * cuentas (sin exponer las claves) y, si cambia, se avisa al dueño.
 */
import { createHash } from "node:crypto";
import { db } from "./db";
import { audit } from "./audit";
import { alertOwner } from "./alerts";

const NO_REQ = { ip: "", country: "", userAgent: "", path: "" };

export type CollectorInfo = {
  mercadopago: { configured: boolean; userId?: string; nickname?: string; site?: string; error?: string };
  izipay: { configured: boolean; shop?: string };
};

const mask = (s: string, keep = 4) => (s.length <= keep ? s : `${"•".repeat(Math.min(6, s.length - keep))}${s.slice(-keep)}`);

/** A qué cuentas está conectada la tienda ahora (datos enmascarados). */
export async function collectorInfo(): Promise<CollectorInfo & { fingerprint: string }> {
  const mpToken = (process.env.MP_ACCESS_TOKEN || "").trim();
  const izUser = (process.env.IZIPAY_USERNAME || "").trim();
  const out: CollectorInfo = { mercadopago: { configured: Boolean(mpToken) }, izipay: { configured: Boolean(izUser) } };
  let mpId = "";
  if (mpToken) {
    try {
      const r = await fetch("https://api.mercadopago.com/users/me", {
        headers: { Authorization: `Bearer ${mpToken}` },
        signal: AbortSignal.timeout(8_000),
        cache: "no-store",
      });
      if (r.ok) {
        const me = (await r.json()) as { id?: number; nickname?: string; site_id?: string };
        mpId = String(me.id ?? "");
        out.mercadopago = { configured: true, userId: mask(mpId), nickname: mask(String(me.nickname ?? ""), 3), site: me.site_id };
      } else out.mercadopago.error = `Mercado Pago respondió ${r.status}`;
    } catch (e) {
      out.mercadopago.error = e instanceof Error ? e.message : String(e);
    }
  }
  if (izUser) out.izipay = { configured: true, shop: mask(izUser) };
  // Huella completa (no reversible) para comparar entre revisiones.
  const fingerprint = createHash("sha256").update(`mp:${mpId}|iz:${izUser}`).digest("hex").slice(0, 16);
  return { ...out, fingerprint };
}

/**
 * Desde el worker, como mucho una vez por hora: si la cuenta de cobro cambió
 * respecto de la última revisión, alerta de seguridad al dueño (correo + campana).
 */
export async function watchCollector(): Promise<{ changed: boolean } | null> {
  const supa = db();
  const since = new Date(Date.now() - 60 * 60_000).toISOString();
  const { data: recent, error } = await supa.from("web_audit_log").select("id").eq("action", "payments.collector_check").gte("created_at", since).limit(1);
  if (error || recent?.length) return null;
  const info = await collectorInfo();
  if (info.mercadopago.error) {
    await audit({ action: "payments.collector_check", level: "warn", details: { error: info.mercadopago.error }, meta: NO_REQ });
    return null; // sin dato fiable no se compara
  }
  const { data: last } = await supa
    .from("web_audit_log")
    .select("details")
    .eq("action", "payments.collector_check")
    .not("details->>fingerprint", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ details: { fingerprint?: string } }>();
  await audit({
    action: "payments.collector_check",
    details: { fingerprint: info.fingerprint, mp: info.mercadopago.userId ?? "", izipay: info.izipay.shop ?? "" },
    meta: NO_REQ,
  });
  const prev = last?.details?.fingerprint;
  if (prev && prev !== info.fingerprint) {
    await audit({ action: "payments.collector_changed", level: "security", details: { from: prev, to: info.fingerprint }, meta: NO_REQ });
    await alertOwner(
      "collector-changed",
      "La cuenta que recibe los pagos CAMBIÓ",
      {
        "Mercado Pago (cuenta)": `${info.mercadopago.userId ?? "—"} ${info.mercadopago.nickname ?? ""}`.trim(),
        "Izipay (tienda)": info.izipay.shop ?? "—",
        "Qué hacer":
          "Si no cambiaste MP_ACCESS_TOKEN ni IZIPAY_USERNAME en Vercel, alguien más pudo hacerlo: revisa Vercel → Settings → Environment Variables y el registro de actividad, cambia tus contraseñas y regenera las credenciales.",
      },
      0
    );
    return { changed: true };
  }
  return { changed: false };
}
