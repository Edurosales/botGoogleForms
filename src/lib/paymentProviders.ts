/**
 * Qué medios de pago se ofrecen en la tienda: lo elige el admin
 * (Configuración → Medios de pago) y solo se muestran los que además tienen
 * sus claves cargadas en Vercel. dLocal Go reemplaza a Mercado Pago; las
 * opciones con Mercado Pago quedan para quien todavía las tenga elegidas.
 */
import type { AppSettings } from "./db";
import type { Provider } from "./webFulfill";
import { mpConfigured } from "./mercadopago";
import { dlocalConfigured } from "./dlocalgo";

function izipayConfigured(): boolean {
  return Boolean((process.env.IZIPAY_PASSWORD || "").trim() && (process.env.IZIPAY_PUBLIC_KEY || "").trim());
}

const READY: Record<Provider, () => boolean> = {
  izipay: izipayConfigured,
  mercadopago: mpConfigured,
  dlocalgo: dlocalConfigured,
};

const CHOICES: Record<string, Provider[]> = {
  izipay: ["izipay"],
  dlocalgo: ["dlocalgo"],
  izipay_dlocalgo: ["dlocalgo", "izipay"],
  mercadopago: ["mercadopago"],
  both: ["mercadopago", "izipay"],
};

export function activeProviders(settings: AppSettings): Provider[] {
  const wanted = CHOICES[settings.payment_provider ?? "izipay"] ?? ["izipay"];
  const ready = wanted.filter((p) => READY[p]());
  // Si el elegido no tiene claves, se cae a otro antes que dejar la tienda sin pagos.
  if (ready.length) return ready;
  for (const p of ["dlocalgo", "izipay", "mercadopago"] as Provider[]) if (READY[p]()) return [p];
  return [];
}
