/**
 * Mercado Pago — Checkout Pro (el cliente paga en la página oficial de
 * Mercado Pago: tarjeta, Yape, PagoEfectivo, saldo MP…).
 *
 * Variables (Vercel, proyecto del servicio):
 *   MP_ACCESS_TOKEN        Access Token (secreto) de "Credenciales"
 *   MP_WEBHOOK_SECRET      Clave secreta de Webhooks (Tus integraciones)
 *   MP_ALLOW_TEST_PAYMENTS "true" solo mientras se prueba con credenciales
 *                          de prueba (pagos con live_mode=false)
 *
 * Seguridad: un aviso (webhook) nunca acredita por sí solo. Se valida la
 * firma y además se vuelve a pedir el pago a la API con nuestro token:
 * solo cuenta lo que diga Mercado Pago, no lo que diga el aviso.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const API = "https://api.mercadopago.com";

function token(): string {
  return (process.env.MP_ACCESS_TOKEN || "").trim();
}

export function mpConfigured(): boolean {
  return token().length > 20;
}

export type MpPayment = {
  id: number;
  status: string; // approved | pending | in_process | rejected | cancelled | refunded | charged_back
  status_detail?: string;
  transaction_amount: number;
  currency_id: string;
  external_reference?: string;
  live_mode?: boolean;
  payment_method_id?: string;
  payment_type_id?: string;
  date_approved?: string | null;
  transaction_amount_refunded?: number;
};

async function mpFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const body = (await r.json().catch(() => ({}))) as T & { message?: string; error?: string };
  if (!r.ok) throw new Error(`Mercado Pago ${r.status}: ${body.message || body.error || "error"}`);
  return body;
}

/** Crea la preferencia de pago y devuelve el link de Checkout Pro. */
export async function createPreference(opts: {
  orderId: string;
  title: string;
  amountCents: number;
  email: string;
  name?: string;
  siteUrl: string;
}): Promise<{ id: string; url: string }> {
  // Más datos del comprador y del producto = menos rechazos "por riesgo"
  // (recomendación de calidad de integración de Mercado Pago).
  const [firstName, ...rest] = (opts.name || "").trim().split(/\s+/);
  const back = `${opts.siteUrl}/api/web/mercadopago/return`;
  const pref = await mpFetch<{ id: string; init_point: string; sandbox_init_point?: string }>("/checkout/preferences", {
    method: "POST",
    headers: { "X-Idempotency-Key": opts.orderId },
    body: JSON.stringify({
      items: [
        {
          id: opts.orderId,
          title: opts.title,
          description: "Créditos para enviar respuestas de prueba a tu Google Form con FormsBot",
          // Checkout Pro muestra el título y la imagen (la descripción no se ve).
          picture_url: `${opts.siteUrl}/email-logo.png`,
          category_id: "services",
          quantity: 1,
          currency_id: "PEN",
          unit_price: Math.round(opts.amountCents) / 100,
        },
      ],
      payer: { email: opts.email, ...(firstName ? { name: firstName } : {}), ...(rest.length ? { surname: rest.join(" ") } : {}) },
      external_reference: opts.orderId,
      back_urls: { success: back, pending: back, failure: back },
      auto_return: "approved",
      notification_url: `${opts.siteUrl}/api/web/mercadopago/webhook?source_news=webhooks`,
      statement_descriptor: "FORMSBOT",
      binary_mode: false,
      metadata: { order_id: opts.orderId },
    }),
  });
  return { id: pref.id, url: pref.init_point };
}

export async function getPayment(id: string): Promise<MpPayment> {
  if (!/^\d{1,20}$/.test(id)) throw new Error("id de pago inválido");
  return mpFetch<MpPayment>(`/v1/payments/${id}`);
}

/**
 * Firma del webhook: cabecera x-signature "ts=…,v1=…". El texto firmado es
 * "id:<data.id>;request-id:<x-request-id>;ts:<ts>;" (se omite lo que falte;
 * data.id en minúsculas si es alfanumérico), HMAC-SHA256 con la clave
 * secreta de Webhooks.
 */
export function verifyWebhookSignature(headers: Headers, dataId: string): boolean | null {
  const secret = (process.env.MP_WEBHOOK_SECRET || "").trim();
  if (!secret) return null; // sin clave configurada: se confía solo en la consulta a la API
  const sig = headers.get("x-signature") || "";
  const requestId = headers.get("x-request-id") || "";
  const parts = Object.fromEntries(
    sig.split(",").map((p) => {
      const [k, ...v] = p.trim().split("=");
      return [k, v.join("=")];
    })
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;
  const id = /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
  const manifest = `${id ? `id:${id};` : ""}${requestId ? `request-id:${requestId};` : ""}ts:${ts};`;
  const expected = createHmac("sha256", secret).update(manifest).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Motivo por el que un pago NO debe acreditarse, o null si está bien. */
export function mpPaymentProblem(p: MpPayment, orderId: string, amountCents: number, currency: string): string | null {
  if (p.external_reference !== orderId) return "el pago no corresponde a este pedido";
  if (p.status !== "approved") return `estado ${p.status}${p.status_detail ? ` (${p.status_detail})` : ""}`;
  if (p.live_mode === false && process.env.MP_ALLOW_TEST_PAYMENTS !== "true") return "pago de prueba (live_mode=false)";
  if ((p.currency_id || "").toUpperCase() !== currency.toUpperCase()) return `moneda ${p.currency_id}`;
  if (Math.round(Number(p.transaction_amount) * 100) !== amountCents) return `monto ${p.transaction_amount}`;
  return null;
}

/** ¿El pago fue devuelto o desconocido por el banco? */
export function mpIsRefund(p: MpPayment): boolean {
  return p.status === "refunded" || p.status === "charged_back" || (Number(p.transaction_amount_refunded) || 0) > 0;
}
