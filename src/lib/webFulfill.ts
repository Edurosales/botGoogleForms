/**
 * Procesa una respuesta de Izipay YA verificada por hash (return o IPN),
 * para compras de créditos. Mismo patrón que license-server/src/lib/fulfill.ts
 * (claim atómico por order_id + verificación de monto/moneda), pero acredita
 * saldo en `web_users.credits` en vez de emitir una licencia.
 */
import { db } from "./db";
import { isRefundAnswer, paymentProblem, type IzipayAnswer } from "./izipay";
import { addCredits } from "./credits";
import { incrementCouponUse } from "./coupons";

type CreditOrder = {
  id: string;
  order_id: string;
  user_id: string;
  credits: number;
  amount_cents: number;
  currency: string;
  status: "pending" | "paid" | "failed" | "refunded";
  coupon_code?: string;
};

export async function processPaidCreditOrder(answer: IzipayAnswer): Promise<{ ok: boolean; orderId?: string; reason?: string }> {
  const orderId = answer.orderDetails?.orderId;
  if (!orderId) return { ok: false, reason: "sin orderId" };
  const supa = db();

  const { data: order } = await supa.from("web_credit_orders").select("*").eq("order_id", orderId).maybeSingle<CreditOrder>();
  if (!order) return { ok: false, orderId, reason: "orden desconocida" };

  // Devolución hecha en el panel de Izipay: revertir el pedido y retirar los
  // créditos (función SQL atómica; idempotente si el aviso llega dos veces).
  if (isRefundAnswer(answer) && order.status !== "pending") {
    if (order.status !== "paid") return { ok: false, orderId, reason: `devolución ignorada (estado ${order.status})` };
    const { data, error } = await supa.rpc("web_refund_order", { p_order: orderId, p_note: "Devolución desde Izipay" });
    if (error) throw new Error(`No se pudo registrar la devolución: ${error.message}`);
    const row = Array.isArray(data) ? data[0] : data;
    console.info(`[izipay-web] devolución ${orderId}:`, row?.message);
    return { ok: false, orderId, reason: "devolución registrada" };
  }

  // amount_cents guarda el monto FINAL cobrado (ya con el descuento del cupón).
  const problem = paymentProblem(answer, order.amount_cents, order.currency);
  if (problem) {
    if (order.status === "pending" && answer.orderStatus !== "RUNNING") {
      await supa.from("web_credit_orders").update({ status: "failed", raw_answer: answer }).eq("id", order.id).eq("status", "pending");
    }
    console.error("[izipay-web] pago no válido, no se acredita:", orderId, problem);
    return { ok: false, orderId, reason: problem };
  }

  if (order.status === "paid") return { ok: true, orderId, reason: "ya procesada" };

  // Claim atómico: el return del navegador y el IPN llegan casi juntos; solo uno acredita.
  const { data: claimed } = await supa
    .from("web_credit_orders")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      izipay_uuid: answer.transactions?.[0]?.uuid ?? "",
      raw_answer: answer,
    })
    .eq("id", order.id)
    .in("status", ["pending", "failed"])
    .select()
    .maybeSingle<CreditOrder>();

  if (!claimed) return { ok: true, orderId, reason: "ya procesada" };

  // Suma atómica en SQL (antes era leer-sumar-escribir y dos pagos casi
  // simultáneos del mismo usuario podían pisarse y perder créditos).
  await addCredits(claimed.user_id, claimed.credits);
  if (claimed.coupon_code) await incrementCouponUse(claimed.coupon_code);

  return { ok: true, orderId };
}
