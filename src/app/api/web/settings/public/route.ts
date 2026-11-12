import { NextResponse, connection } from "next/server";
import { getAppSettings } from "@/lib/appSettings";
import { DEFAULT_BUY_SOFTWARE_URL, DEFAULT_WHATSAPP, MAX_FREE_QUESTIONS } from "@/lib/webConfig";
import { activeProviders } from "@/lib/paymentProviders";
import { db } from "@/lib/db";

/** Cifras reales para la tienda (ronda_45). Sin la función aún creada: null y no se muestran. */
async function publicStats(): Promise<{ responses: number; forms: number } | null> {
  try {
    const { data, error } = await db().rpc("web_public_stats");
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row) return null;
    return { responses: Number(row.responses) || 0, forms: Number(row.forms) || 0 };
  } catch {
    return null;
  }
}

/** Configuración pública (sin secretos) para la UI. */
export async function GET() {
  // Siempre en tiempo de petición: si se prerenderiza en el build, los
  // precios/WhatsApp que el admin cambie no se verían hasta el próximo deploy.
  await connection();
  const [s, stats] = await Promise.all([getAppSettings(), publicStats()]);
  return NextResponse.json({
    ok: true,
    creditPackages: s.credit_packages,
    whatsappNumber: (s.whatsapp_number || DEFAULT_WHATSAPP).replace(/\D/g, ""),
    whatsappMessageTemplate: s.whatsapp_message_template,
    buySoftwareUrl: s.buy_software_url || DEFAULT_BUY_SOFTWARE_URL,
    // Solo pago: la página no promete nada gratis.
    freeSignupCredits: s.paid_only ? 0 : s.free_signup_credits,
    maxFreeQuestions: s.max_free_questions ?? MAX_FREE_QUESTIONS,
    paidOnly: s.paid_only === true,
    freePaused: s.free_paused === true || s.service_paused === true,
    paymentProviders: activeProviders(s),
    mpRequiresLogin: s.mp_require_login === true,
    purchasesPaused: s.purchases_paused === true,
    purchasesPauseMessage: s.purchases_pause_message || "",
    banner: s.banner_message ? { message: s.banner_message, kind: s.banner_kind || "info" } : null,
    maxPaidQuestions: s.max_paid_questions ?? 60,
    maxDailyResponses: s.max_daily_responses ?? 500,
    dailyPurchaseCap: s.daily_purchase_cap ?? 500,
    // Solo cifras públicas del programa (lo mismo que dice la página "Invita y gana").
    referral: s.referral_enabled
      ? {
          referrerCredits: s.referral_reward_referrer ?? 20,
          referredCredits: s.referral_reward_referred ?? 10,
          minPurchaseCents: s.referral_min_purchase_cents ?? 1500,
          days: s.referral_cookie_days ?? 30,
        }
      : null,
    lowCreditsThreshold: s.low_credits_enabled === false ? 0 : (s.low_credits_threshold ?? 20),
    // Solo comentarios que el dueño cargó en el panel (reales); nunca inventados.
    testimonials: Array.isArray(s.testimonials) ? s.testimonials.slice(0, 12) : [],
    stats,
  }, {
    // Igual para todos (no lee cookies ni cabeceras del usuario): el CDN de Vercel
    // la sirve sin ejecutar la función. Un cambio en el panel se ve en ≤1 min;
    // pausas, precios y "solo pago" igual los hace cumplir el servidor al comprar/enviar.
    // Navegador: 30 s sin volver a preguntar. CDN de Vercel: 60 s y, mientras
    // revalida, sirve la copia anterior hasta 5 min (sin ejecutar la función).
    headers: {
      "Cache-Control": "public, max-age=30",
      "Vercel-CDN-Cache-Control": "max-age=60, stale-while-revalidate=300",
    },
  });
}
