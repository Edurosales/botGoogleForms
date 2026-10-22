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
import { notifyAdmin, notifyUser } from "./notify";
import { audit } from "./audit";
import { sendServiceEmail } from "./mailer";
import { siteUrl } from "./config";
const pen = (c: number) => `S/ ${(c / 100).toFixed(2)}`;

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
    if (row?.ok) {
      await supa
        .from("web_credit_orders")
        .update({ refund_reason: "Devolución procesada desde la pasarela de pago." })
        .eq("order_id", orderId);
      await notifyUser(order.user_id, {
        kind: "refund",
        title: `Te devolvimos ${pen(order.amount_cents)}`,
        body: `Pedido ${orderId}: se retiraron de tu saldo los créditos de esa compra que aún tenías.`,
        link: "/mi-cuenta",
      });
      await sendServiceEmail(order.user_id, "refund", {
        subject: `Te devolvimos ${pen(order.amount_cents)} (pedido ${orderId})`,
        title: `Devolución de ${pen(order.amount_cents)}`,
        bodyHtml: `<p>Procesamos la devolución del pedido <strong>${orderId}</strong> a la misma tarjeta. Según tu banco, puede tardar unos días en verse.</p><p>Se retiraron de tu saldo los créditos de esa compra que aún tenías.</p>`,
        cta: { label: "Ver mi cuenta", url: `${siteUrl()}/mi-cuenta` },
      });
      await notifyAdmin({
        kind: "refund",
        title: `Devolución registrada: ${pen(order.amount_cents)}`,
        body: `Pedido ${orderId}, avisada por Izipay. ${row.message ?? ""}`,
        link: "/admin#web-orders",
      });
    }
    await audit({
      action: "payment.refund",
      level: "warn",
      userId: order.user_id,
      target: orderId,
      details: { amount_cents: order.amount_cents, credits: order.credits, message: row?.message ?? "", source: "izipay" },
      meta: { ip: "", country: "", userAgent: "", path: "" },
    });
    console.info(`[izipay-web] devolución ${orderId}:`, row?.message);
    return { ok: false, orderId, reason: "devolución registrada" };
  }

  // amount_cents guarda el monto FINAL cobrado (ya con el descuento del cupón).
  const problem = paymentProblem(answer, order.amount_cents, order.currency);
  if (problem) {
    if (order.status === "pending" && answer.orderStatus !== "RUNNING") {
      await supa.from("web_credit_orders").update({ status: "failed", raw_answer: answer }).eq("id", order.id).eq("status", "pending");
    }
    await audit({
      action: "payment.rejected",
      level: "security",
      userId: order.user_id,
      target: orderId,
      details: { problem, orderStatus: answer.orderStatus ?? "" },
      meta: { ip: "", country: "", userAgent: "", path: "" },
    });
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

  const { data: buyer } = await supa.from("web_users").select("email").eq("id", claimed.user_id).maybeSingle<{ email: string }>();
  await notifyUser(claimed.user_id, {
    kind: "purchase",
    title: `Compra confirmada: +${claimed.credits} créditos`,
    body: `Pagaste ${pen(claimed.amount_cents)} (pedido ${claimed.order_id}). Ya puedes usarlos.`,
    link: "/mi-cuenta",
  });
  await sendServiceEmail(claimed.user_id, "purchase", {
    subject: `Compra confirmada: +${claimed.credits} créditos`,
    title: `¡Gracias! Sumamos ${claimed.credits} créditos`,
    bodyHtml: `<p>Pagaste <strong>${pen(claimed.amount_cents)}</strong> (pedido ${claimed.order_id}). Tus créditos ya están en tu saldo y tus envíos tienen prioridad en la fila.</p><p>Guarda este correo como comprobante de tu compra.</p>`,
    cta: { label: "Usar mis créditos", url: `${siteUrl()}/` },
  });
  await notifyAdmin({
    kind: "purchase",
    title: `Nueva compra: ${pen(claimed.amount_cents)}`,
    body: `${buyer?.email ?? "Un cliente"} compró ${claimed.credits} créditos (pedido ${claimed.order_id}).`,
    link: "/admin#web-orders",
  });

  await audit({
    action: "payment.paid",
    userId: claimed.user_id,
    email: buyer?.email ?? "",
    target: claimed.order_id,
    details: { amount_cents: claimed.amount_cents, credits: claimed.credits, coupon: claimed.coupon_code || "" },
    meta: { ip: "", country: "", userAgent: "", path: "" },
  });
  return { ok: true, orderId };
}
