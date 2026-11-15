import { NextResponse } from "next/server";
import { dlocalConfigured, verifyDlocalSignature } from "@/lib/dlocalgo";
import { processDlocalPayment } from "@/lib/dlocalFulfill";
import { audit } from "@/lib/audit";

/**
 * Notificaciones de dLocal Go (la URL va en cada pago: notification_url).
 * Firma HMAC-SHA256 en la cabecera Authorization; sin firma válida → 401.
 * 200 = recibido (si respondemos otra cosa, dLocal Go reintenta cada 10 min).
 * El estado SIEMPRE se consulta a la API: el cuerpo solo trae el id.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!dlocalConfigured()) return NextResponse.json({ ok: true, ignored: true });
  if (!verifyDlocalSignature(req.headers.get("authorization") || "", raw)) {
    await audit({ action: "payment.webhook_bad_signature", level: "security", target: "", details: { provider: "dlocalgo" } });
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  let body: { payment_id?: unknown } = {};
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true, ignored: true });
  }
  const paymentId = String(body.payment_id ?? "");
  // Solo pagos (DP-…); las devoluciones se revisan a mano en el panel.
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(paymentId)) return NextResponse.json({ ok: true, ignored: true });
  try {
    const r = await processDlocalPayment(paymentId);
    return NextResponse.json({ ok: true, result: r.reason ?? (r.ok ? "acreditado" : "sin cambios") });
  } catch (e) {
    console.error("[dlocalgo] webhook:", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
