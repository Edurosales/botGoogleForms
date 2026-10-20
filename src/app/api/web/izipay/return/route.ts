import { NextResponse } from "next/server";
import { IzipayAnswer, verifyIzipayHash } from "@/lib/izipay";
import { processPaidCreditOrder } from "@/lib/webFulfill";
import { siteUrl } from "@/lib/config";

/** Retorno del navegador tras el SmartForm. Redirige a /comprar-creditos con el resultado. */
export async function POST(req: Request) {
  const site = siteUrl();
  const form = await req.formData().catch(() => null);
  const answerStr = String(form?.get("kr-answer") ?? "");
  const ok = verifyIzipayHash({
    answer: answerStr,
    hash: String(form?.get("kr-hash") ?? ""),
    hashKey: String(form?.get("kr-hash-key") ?? ""),
    algorithm: String(form?.get("kr-hash-algorithm") ?? ""),
  });
  if (!ok) return NextResponse.redirect(`${site}/comprar-creditos?error=firma`, 303);

  let answer: IzipayAnswer;
  try {
    answer = JSON.parse(answerStr) as IzipayAnswer;
  } catch {
    return NextResponse.redirect(`${site}/comprar-creditos?error=datos`, 303);
  }

  const res = await processPaidCreditOrder(answer);
  if (res.ok && res.orderId) return NextResponse.redirect(`${site}/comprar-creditos?pagado=${encodeURIComponent(res.orderId)}`, 303);
  return NextResponse.redirect(`${site}/comprar-creditos?error=pago`, 303);
}
