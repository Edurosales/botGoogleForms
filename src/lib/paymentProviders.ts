/**
 * Qué medios de pago se ofrecen en la tienda: lo elige el admin
 * (Configuración → Medios de pago: Izipay, Mercado Pago o ambos) y solo se
 * muestran los que además tienen sus claves cargadas en Vercel.
 */
import type { AppSettings } from "./db";
import type { Provider } from "./webFulfill";
import { mpConfigured } from "./mercadopago";

function izipayConfigured(): boolean {
  return Boolean((process.env.IZIPAY_PASSWORD || "").trim() && (process.env.IZIPAY_PUBLIC_KEY || "").trim());
}

export function activeProviders(settings: AppSettings): Provider[] {
  const choice = settings.payment_provider ?? "izipay";
  const wanted: Provider[] = choice === "both" ? ["mercadopago", "izipay"] : choice === "mercadopago" ? ["mercadopago"] : ["izipay"];
  const ready = wanted.filter((p) => (p === "mercadopago" ? mpConfigured() : izipayConfigured()));
  // Si el elegido no tiene claves, se cae al otro antes que dejar la tienda sin pagos.
  if (ready.length) return ready;
  if (mpConfigured()) return ["mercadopago"];
  if (izipayConfigured()) return ["izipay"];
  return [];
}
