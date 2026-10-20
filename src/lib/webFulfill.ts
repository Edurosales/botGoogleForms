/**
 * Procesa una respuesta de Izipay YA verificada por hash (return o IPN),
 * para compras de créditos. Mismo patrón que license-server/src/lib/fulfill.ts
 * (claim atómico por order_id + verificación de monto/moneda), pero acredita
 * saldo en `web_users.credits` en vez de emitir una licencia.
 */
import { db } from "./db";
import type { IzipayAnswer } from "./izipay";

type CreditOrder = {
  id: string;
  order_id: string;
  user_id: string;
  credits: number;
  amount_cents: number;
  currency: string;
  status: "pending" | "paid" | "failed" | "refunded";
};

export async function processPaidCreditOrder(answer: IzipayAnswer): Promise<{ ok: boolean; orderId?: string; reason?: string }> {
  const orderId = answer.orderDetails?.orderId;
  if (!orderId) return { ok: false, reason: "sin orderId" };
  const supa = db();

  const { data: order } = await supa.from("web_credit_orders").select("*").eq("order_id", orderId).maybeSingle<CreditOrder>();
  if (!order) return { ok: false, orderId, reason: "orden desconocida" };

  if (answer.orderStatus !== "PAID") {
    if (order.status === "pending" && answer.orderStatus === "UNPAID") {
      await supa.from("web_credit_orders").update({ status: "failed", raw_answer: answer }).eq("id", order.id).eq("status", "pending");
    }
    return { ok: false, orderId, reason: `estado ${answer.orderStatus}` };
  }

  if (answer.orderDetails?.orderTotalAmount !== order.amount_cents || answer.orderDetails?.orderCurrency !== order.currency) {
    console.error("[izipay-web] monto/moneda no coinciden", orderId, answer.orderDetails);
    return { ok: false, orderId, reason: "monto no coincide" };
  }

  if (order.status === "paid") return { ok: true, orderId, reason: "ya procesada" };

  const { data: claimed } = await supa
    .from("web_credit_orders")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      izipay_uuid: answer.transactions?.[0]?.uuid ?? "",
      raw_answer: answer,
    })
    .eq("id", order.id)
    .eq("status", "pending")
    .select()
    .maybeSingle<CreditOrder>();

  if (!claimed) return { ok: true, orderId, reason: "ya procesada" };

  const { data: userRow } = await supa.from("web_users").select("credits").eq("id", claimed.user_id).single<{ credits: number }>();
  const current = userRow?.credits ?? 0;
  await supa.from("web_users").update({ credits: current + claimed.credits }).eq("id", claimed.user_id);

  return { ok: true, orderId };
}
