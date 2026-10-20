import { NextResponse } from "next/server";
import { IzipayAnswer, verifyIzipayHash } from "@/lib/izipay";
import { processPaidCreditOrder } from "@/lib/webFulfill";

/** IPN de Izipay para compras de créditos. Siempre responde 200 si la firma es válida. */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const answerStr = String(form?.get("kr-answer") ?? "");
  const ok = verifyIzipayHash({
    answer: answerStr,
    hash: String(form?.get("kr-hash") ?? ""),
    hashKey: String(form?.get("kr-hash-key") ?? ""),
    algorithm: String(form?.get("kr-hash-algorithm") ?? ""),
  });
  if (!ok) return new NextResponse("invalid signature", { status: 401 });

  try {
    const res = await processPaidCreditOrder(JSON.parse(answerStr) as IzipayAnswer);
    return new NextResponse(res.ok ? `OK=${res.orderId}` : `IGNORED=${res.reason}`, { status: 200 });
  } catch (e) {
    console.error("[web-ipn error]", e);
    return new NextResponse(`ERROR_LOGGED=${e instanceof Error ? e.message : String(e)}`, { status: 200 });
  }
}
