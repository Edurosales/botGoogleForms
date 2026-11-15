/**
 * dLocal Go (https://docs.dlocalgo.com/integration-api): reemplaza a Mercado
 * Pago en la tienda. Flujo:
 *  1. POST /v1/payments → `redirect_url` (checkout de dLocal Go) y `id` (DP-…).
 *  2. El cliente paga allá y vuelve a /api/web/dlocalgo/return.
 *  3. dLocal Go avisa cada cambio a `notification_url` (POST firmado).
 *  En los pasos 2 y 3 NUNCA se cree en lo que llega: se consulta el pago a la
 *  API (GET /v1/payments/:id) y recién ahí se acredita (idempotente).
 *
 * Claves solo en variables de entorno (Vercel), nunca en archivos:
 *   DLOCALGO_API_KEY, DLOCALGO_SECRET_KEY
 *   DLOCALGO_SANDBOX=true → usa el entorno de prueba (api-sbx); por defecto, producción.
 *   DLOCALGO_ALLOW_TEST_PAYMENTS=true → acredita pagos del sandbox (solo para probar).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

function apiKey(): string {
  return (process.env.DLOCALGO_API_KEY || "").trim();
}
function secretKey(): string {
  return (process.env.DLOCALGO_SECRET_KEY || "").trim();
}
export function dlocalSandbox(): boolean {
  return (process.env.DLOCALGO_SANDBOX || "").trim().toLowerCase() === "true";
}
function base(): string {
  return dlocalSandbox() ? "https://api-sbx.dlocalgo.com" : "https://api.dlocalgo.com";
}

export function dlocalConfigured(): boolean {
  return Boolean(apiKey() && secretKey());
}

/** Dominios a los que el navegador puede ir a pagar (evita redirecciones abiertas). */
export const DLOCAL_CHECKOUT_RE = /^https:\/\/checkout(-sbx)?\.dlocalgo\.com\//i;

export type DlocalPayment = {
  id: string;
  amount: number;
  currency: string;
  country?: string;
  status: "PENDING" | "PAID" | "REJECTED" | "CANCELLED" | "EXPIRED" | string;
  status_detail?: string | null;
  order_id?: string;
  redirect_url?: string;
  created_date?: string;
};

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${base()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey()}:${secretKey()}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const text = await r.text();
  if (!r.ok) {
    // Nunca se registran las claves; solo el código y el mensaje de dLocal Go.
    throw new Error(`dLocal Go ${r.status}: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text) as T;
}

export async function createDlocalPayment(opts: {
  orderId: string;
  amountCents: number;
  description: string;
  email: string;
  name: string;
  userId: string;
  successUrl: string;
  backUrl: string;
  notificationUrl: string;
}): Promise<{ id: string; url: string }> {
  const p = await call<DlocalPayment>("POST", "/v1/payments", {
    currency: "PEN",
    amount: Math.round(opts.amountCents) / 100,
    country: "PE",
    order_id: opts.orderId,
    description: opts.description.slice(0, 100),
    success_url: opts.successUrl,
    back_url: opts.backUrl,
    notification_url: opts.notificationUrl,
    // El pago vence en 2 horas: igual que el seguimiento de pedidos abandonados.
    expiration_type: "HOURS",
    expiration_value: 2,
    payer: {
      name: (opts.name || opts.email).slice(0, 100),
      email: opts.email.slice(0, 100),
      user_reference: opts.userId,
    },
  });
  if (!p.redirect_url || !DLOCAL_CHECKOUT_RE.test(p.redirect_url)) throw new Error("dLocal Go no devolvió un enlace de pago válido.");
  return { id: p.id, url: p.redirect_url };
}

export async function getDlocalPayment(id: string): Promise<DlocalPayment> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error("id de pago no válido");
  return call<DlocalPayment>("GET", `/v1/payments/${encodeURIComponent(id)}`);
}

/**
 * Firma de las notificaciones: cabecera Authorization
 * "V2-HMAC-SHA256, Signature: <hex>", donde <hex> = HMAC-SHA256(secret, apiKey + cuerpo crudo).
 */
export function verifyDlocalSignature(authHeader: string, rawBody: string): boolean {
  const m = /Signature:\s*([a-f0-9]{64})/i.exec(authHeader || "");
  if (!m || !dlocalConfigured()) return false;
  const expected = createHmac("sha256", secretKey()).update(apiKey() + rawBody).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(m[1].toLowerCase(), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Motivo por el que un pago NO debe acreditarse, o null si está bien. */
export function dlocalPaymentProblem(p: DlocalPayment, orderId: string, amountCents: number, currency: string): string | null {
  if ((p.order_id || "") !== orderId) return "el pago no corresponde a este pedido";
  if (p.status !== "PAID") return `estado ${p.status}${p.status_detail ? ` (${p.status_detail})` : ""}`;
  if (dlocalSandbox() && process.env.DLOCALGO_ALLOW_TEST_PAYMENTS !== "true") return "pago de prueba (sandbox)";
  if ((p.currency || "").toUpperCase() !== currency.toUpperCase()) return `moneda ${p.currency}`;
  if (Math.round(Number(p.amount) * 100) !== amountCents) return `monto ${p.amount}`;
  return null;
}
