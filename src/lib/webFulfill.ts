/**
 * Acredita (o revierte) compras de créditos ya verificadas con la pasarela.
 * Mismo patrón que license-server/src/lib/fulfill.ts (claim atómico por
 * order_id + verificación de monto/moneda), pero acredita saldo en
 * `web_users.credits` en vez de emitir una licencia.
 *
 * Lo común a las dos pasarelas (Izipay y Mercado Pago) está en
 * `creditPaidOrder` y `refundCreditOrder`: avisos, correo, cupón y registros
 * salen iguales sin importar cómo se pagó.
 */
import { db } from "./db";
import { isRefundAnswer, paymentProblem, type IzipayAnswer } from "./izipay";
import { addCredits } from "./credits";
import { incrementCouponUse } from "./coupons";
import { notifyAdmin, notifyUser } from "./notify";
import { audit } from "./audit";
import { escapeHtml, mailDate, sendServiceEmail, summaryTable } from "./mailer";
import { siteUrl } from "./config";
const pen = (c: number) => `S/ ${(c / 100).toFixed(2)}`;
const NO_REQ = { ip: "", country: "", userAgent: "", path: "" };

export type CreditOrder = {
  id: string;
  order_id: string;
  user_id: string;
  credits: number;
  amount_cents: number;
  currency: string;
  status: "pending" | "paid" | "failed" | "refunded";
  coupon_code?: string;
  provider?: string;
};

export type Provider = "izipay" | "mercadopago";

const PROVIDER_LABEL: Record<Provider, string> = {
  izipay: "Tarjeta (Izipay)",
  mercadopago: "Mercado Pago",
};

export type FulfillResult = { ok: boolean; orderId?: string; reason?: string };

export async function findCreditOrder(orderId: string): Promise<CreditOrder | null> {
  const { data } = await db().from("web_credit_orders").select("*").eq("order_id", orderId).maybeSingle<CreditOrder>();
  return data ?? null;
}

/**
 * Devolución hecha en el panel de la pasarela: revierte el pedido y retira
 * los créditos (función SQL atómica; idempotente si el aviso llega dos veces).
 */
export async function refundCreditOrder(order: CreditOrder, provider: Provider): Promise<FulfillResult> {
  const orderId = order.order_id;
  if (order.status !== "paid") return { ok: false, orderId, reason: `devolución ignorada (estado ${order.status})` };
  const supa = db();
  const { data, error } = await supa.rpc("web_refund_order", { p_order: orderId, p_note: `Devolución desde ${PROVIDER_LABEL[provider]}` });
  if (error) throw new Error(`No se pudo registrar la devolución: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (row?.ok) {
    await supa.from("web_credit_orders").update({ refund_reason: "Devolución procesada desde la pasarela de pago." }).eq("order_id", orderId);
    await notifyUser(order.user_id, {
      kind: "refund",
      title: `Te devolvimos ${pen(order.amount_cents)}`,
      body: `Pedido ${orderId}: se retiraron de tu saldo los créditos de esa compra que aún tenías.`,
      link: "/mi-cuenta",
    });
    await sendServiceEmail(order.user_id, "refund", {
      subject: `Te devolvimos ${pen(order.amount_cents)} (pedido ${orderId})`,
      title: `Devolución de ${pen(order.amount_cents)}`,
      bodyHtml:
        `<p>Procesamos la devolución al mismo medio de pago. Según tu banco, puede tardar unos días en verse.</p>` +
        summaryTable([
          ["Pedido", escapeHtml(orderId)],
          ["Monto devuelto", escapeHtml(pen(order.amount_cents))],
          ["Créditos de la compra", String(order.credits)],
          ["Medio de pago", PROVIDER_LABEL[provider]],
          ["Fecha", escapeHtml(mailDate())],
        ]) +
        `<p>Se retiraron de tu saldo los créditos de esa compra que aún tenías.</p>`,
      cta: { label: "Ver mi cuenta", url: `${siteUrl()}/mi-cuenta` },
    });
    await notifyAdmin({
      kind: "refund",
      title: `Devolución registrada: ${pen(order.amount_cents)}`,
      body: `Pedido ${orderId}, avisada por ${PROVIDER_LABEL[provider]}. ${row.message ?? ""}`,
      link: "/admin#web-orders",
    });
  }
  await audit({
    action: "payment.refund",
    level: "warn",
    userId: order.user_id,
    target: orderId,
    details: { amount_cents: order.amount_cents, credits: order.credits, message: row?.message ?? "", source: provider },
    meta: NO_REQ,
  });
  return { ok: false, orderId, reason: "devolución registrada" };
}

/** Marca un pago rechazado/no válido (no acredita) y lo registra. */
export async function rejectCreditOrder(order: CreditOrder, provider: Provider, problem: string, markFailed: boolean, raw: unknown): Promise<FulfillResult> {
  if (markFailed && order.status === "pending") {
    await db().from("web_credit_orders").update({ status: "failed", raw_answer: raw }).eq("id", order.id).eq("status", "pending");
  }
  await audit({
    action: "payment.rejected",
    level: "security",
    userId: order.user_id,
    target: order.order_id,
    details: { problem, provider },
    meta: NO_REQ,
  });
  console.error(`[${provider}-web] pago no válido, no se acredita:`, order.order_id, problem);
  return { ok: false, orderId: order.order_id, reason: problem };
}

/**
 * Acredita un pedido YA verificado como pagado (monto, moneda y estado
 * comprobados por quien llama). Claim atómico: el retorno del navegador y el
 * aviso de la pasarela llegan casi juntos; solo uno acredita.
 */
export async function creditPaidOrder(order: CreditOrder, provider: Provider, ref: string, raw: unknown): Promise<FulfillResult> {
  const supa = db();
  if (order.status === "paid") return { ok: true, orderId: order.order_id, reason: "ya procesada" };

  const { data: claimed } = await supa
    .from("web_credit_orders")
    .update({ status: "paid", paid_at: new Date().toISOString(), izipay_uuid: ref, raw_answer: raw })
    .eq("id", order.id)
    .in("status", ["pending", "failed"])
    .select()
    .maybeSingle<CreditOrder>();

  if (!claimed) return { ok: true, orderId: order.order_id, reason: "ya procesada" };

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
    bodyHtml:
      `<p>Tus créditos ya están en tu saldo y tus envíos tienen prioridad en la fila.</p>` +
      summaryTable([
        ["Pedido", escapeHtml(claimed.order_id)],
        ["Créditos comprados", `+${claimed.credits}`],
        ["Total pagado", escapeHtml(pen(claimed.amount_cents))],
        ...(claimed.coupon_code ? ([["Cupón", escapeHtml(claimed.coupon_code)]] as [string, string][]) : []),
        ["Fecha", escapeHtml(mailDate())],
        ["Medio de pago", PROVIDER_LABEL[provider]],
      ]) +
      `<p>Incluye: fila prioritaria, respuestas con IA y exportar a Excel. Guarda este correo como comprobante.</p>`,
    cta: { label: "Usar mis créditos", url: `${siteUrl()}/` },
  });
  await notifyAdmin({
    kind: "purchase",
    title: `Nueva compra: ${pen(claimed.amount_cents)}`,
    body: `${buyer?.email ?? "Un cliente"} compró ${claimed.credits} créditos con ${PROVIDER_LABEL[provider]} (pedido ${claimed.order_id}).`,
    link: "/admin#web-orders",
  });
  await audit({
    action: "payment.paid",
    userId: claimed.user_id,
    email: buyer?.email ?? "",
    target: claimed.order_id,
    details: { amount_cents: claimed.amount_cents, credits: claimed.credits, coupon: claimed.coupon_code || "", provider },
    meta: NO_REQ,
  });
  return { ok: true, orderId: claimed.order_id };
}

/** Respuesta de Izipay YA verificada por hash (return o IPN). */
export async function processPaidCreditOrder(answer: IzipayAnswer): Promise<FulfillResult> {
  const orderId = answer.orderDetails?.orderId;
  if (!orderId) return { ok: false, reason: "sin orderId" };
  const order = await findCreditOrder(orderId);
  if (!order) return { ok: false, orderId, reason: "orden desconocida" };

  if (isRefundAnswer(answer) && order.status !== "pending") {
    const r = await refundCreditOrder(order, "izipay");
    console.info(`[izipay-web] devolución ${orderId}:`, r.reason);
    return r;
  }

  // amount_cents guarda el monto FINAL cobrado (ya con el descuento del cupón).
  const problem = paymentProblem(answer, order.amount_cents, order.currency);
  if (problem) return rejectCreditOrder(order, "izipay", problem, answer.orderStatus !== "RUNNING", answer);

  return creditPaidOrder(order, "izipay", answer.transactions?.[0]?.uuid ?? "", answer);
}
