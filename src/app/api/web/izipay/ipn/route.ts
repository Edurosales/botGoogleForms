import { NextResponse } from "next/server";
import { IzipayAnswer, verifyIzipayHash } from "@/lib/izipay";
import { processPaidCreditOrder } from "@/lib/webFulfill";

// La regla de notificaciones del panel de Izipay (devoluciones, anulaciones,
// etc.) apunta a ESTA URL para toda la tienda, incluidas las compras de
// licencias del bot de escritorio (pedidos FB-…). Esas se reenvían tal cual
// a license-server, que verifica la firma por su cuenta y revoca la licencia.
const LICENSE_IPN_URL = process.env.LICENSE_IPN_URL || "https://licenses-forms.vercel.app/api/izipay/ipn";

/** IPN de Izipay para compras de créditos. Siempre responde 200 si la firma es válida. */
export async function POST(req: Request) {
  const raw = await req.text().catch(() => "");
  const form = new URLSearchParams(raw);
  const answerStr = form.get("kr-answer") ?? "";
  const ok = verifyIzipayHash({
    answer: answerStr,
    hash: form.get("kr-hash") ?? "",
    hashKey: form.get("kr-hash-key") ?? "",
    algorithm: form.get("kr-hash-algorithm") ?? "",
  });
  if (!ok) return new NextResponse("invalid signature", { status: 401 });

  let answer: IzipayAnswer;
  try {
    answer = JSON.parse(answerStr) as IzipayAnswer;
  } catch {
    return new NextResponse("IGNORED=json", { status: 200 });
  }

  const orderId = answer.orderDetails?.orderId ?? "";
  if (orderId.startsWith("FB-")) {
    try {
      const r = await fetch(LICENSE_IPN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: raw,
        signal: AbortSignal.timeout(20_000),
        cache: "no-store",
      });
      const text = await r.text().catch(() => "");
      // Si license-server falla, devolver error para que Izipay reintente.
      return new NextResponse(`FORWARDED=${r.status} ${text.slice(0, 120)}`, { status: r.ok ? 200 : 502 });
    } catch (e) {
      console.error("[web-ipn] no se pudo reenviar a license-server:", e);
      return new NextResponse("FORWARD_FAILED", { status: 502 });
    }
  }

  try {
    const res = await processPaidCreditOrder(answer);
    return new NextResponse(res.ok ? `OK=${res.orderId}` : `IGNORED=${res.reason}`, { status: 200 });
  } catch (e) {
    console.error("[web-ipn error]", e);
    return new NextResponse(`ERROR_LOGGED=${e instanceof Error ? e.message : String(e)}`, { status: 200 });
  }
}
