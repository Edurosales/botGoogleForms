/**
 * Izipay / Mi Cuenta Web (Lyra) REST V4 + SmartForm en modo redirección.
 * Duplicado a propósito de license-server/src/lib/izipay.ts — es genérico
 * (no depende de licencias), misma función en ambos proyectos independientes.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta variable de entorno ${name}`);
  return v;
}

export function izipayApiUrl(): string {
  return (process.env.IZIPAY_API_URL || "https://api.micuentaweb.pe").replace(/\/+$/, "");
}
export function izipayStaticUrl(): string {
  const raw = (process.env.IZIPAY_STATIC_URL || "https://static.micuentaweb.pe").trim();
  try {
    const url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    return url.origin;
  } catch {
    return "https://static.micuentaweb.pe";
  }
}
export function izipayPublicKey(): string {
  return (process.env.IZIPAY_PUBLIC_KEY || "").trim();
}

export type CreatePaymentInput = {
  amountCents: number;
  currency: string;
  orderId: string;
  email: string;
  name: string;
  ipnUrl: string;
};

export async function createPayment(inp: CreatePaymentInput): Promise<string> {
  const auth = Buffer.from(`${env("IZIPAY_USERNAME")}:${env("IZIPAY_PASSWORD")}`).toString("base64");
  const [firstName, ...rest] = inp.name.trim().split(/\s+/);
  const res = await fetch(`${izipayApiUrl()}/api-payment/V4/Charge/CreatePayment`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: inp.amountCents,
      currency: inp.currency,
      orderId: inp.orderId,
      customer: {
        email: inp.email,
        billingDetails: { firstName: firstName || "", lastName: rest.join(" ") },
      },
      ipnTargetUrl: inp.ipnUrl,
    }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as {
    status?: string;
    answer?: { formToken?: string; errorMessage?: string; errorCode?: string };
  };
  if (json.status !== "SUCCESS" || !json.answer?.formToken) {
    const msg = json.answer?.errorMessage || json.answer?.errorCode || `HTTP ${res.status}`;
    throw new Error(`Izipay: ${msg}`);
  }
  return json.answer.formToken;
}

/** Valida kr-hash = HMAC-SHA256(kr-answer, clave). kr-hash-key indica cual clave usar. */
export function verifyIzipayHash(fields: { answer: string; hash: string; hashKey: string; algorithm?: string }): boolean {
  if ((fields.algorithm || "sha256_hmac") !== "sha256_hmac") return false;
  const key =
    fields.hashKey === "password" ? process.env.IZIPAY_PASSWORD : process.env.IZIPAY_HMAC_KEY;
  if (!key || !fields.answer || !fields.hash) return false;
  const expected = createHmac("sha256", key).update(fields.answer, "utf8").digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(fields.hash.toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

export type IzipayAnswer = {
  orderStatus?: string;
  orderDetails?: { orderId?: string; orderTotalAmount?: number; orderCurrency?: string; mode?: string };
  customer?: { email?: string };
  transactions?: { uuid?: string; status?: string; detailedStatus?: string; amount?: number; currency?: string }[];
};

/** true si las credenciales configuradas son de prueba (Izipay: testpassword_… vs prodpassword_…). */
export function izipayTestCredentials(): boolean {
  return /^testpassword_/i.test((process.env.IZIPAY_PASSWORD || "").trim());
}

/**
 * Motivo por el que NO se debe entregar nada, o null si el pago es real y
 * aprobado. En modo prueba Izipay responde PAID con tarjetas de prueba: sin
 * este control, cualquiera "pagaba" con una tarjeta de prueba y recibía
 * créditos/licencias reales. Para probar a propósito en un entorno de
 * pruebas: IZIPAY_ALLOW_TEST_PAYMENTS=true.
 */
export function paymentProblem(answer: IzipayAnswer, expectedCents: number, expectedCurrency: string): string | null {
  if (answer.orderStatus !== "PAID") return `estado ${answer.orderStatus ?? "desconocido"}`;
  const isTest = answer.orderDetails?.mode === "TEST" || izipayTestCredentials();
  if (isTest && process.env.IZIPAY_ALLOW_TEST_PAYMENTS !== "true") return "pago en modo prueba";
  if (answer.orderDetails?.orderTotalAmount !== expectedCents || answer.orderDetails?.orderCurrency !== expectedCurrency) {
    return "monto o moneda no coinciden";
  }
  const tx = (answer.transactions ?? []).find((t) => t.status === "PAID");
  if (!tx) return "sin transacción pagada";
  if (typeof tx.amount === "number" && tx.amount !== expectedCents) return "monto de la transacción no coincide";
  if (tx.detailedStatus && !["AUTHORISED", "CAPTURED", "ACCEPTED"].includes(tx.detailedStatus)) {
    return `transacción ${tx.detailedStatus}`;
  }
  return null;
}
