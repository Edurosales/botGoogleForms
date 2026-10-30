import { NextResponse, connection } from "next/server";
import { getAppSettings } from "@/lib/appSettings";
import { DEFAULT_BUY_SOFTWARE_URL, DEFAULT_WHATSAPP, MAX_FREE_QUESTIONS } from "@/lib/webConfig";
import { activeProviders } from "@/lib/paymentProviders";

/** Configuración pública (sin secretos) para la UI. */
export async function GET() {
  // Siempre en tiempo de petición: si se prerenderiza en el build, los
  // precios/WhatsApp que el admin cambie no se verían hasta el próximo deploy.
  await connection();
  const s = await getAppSettings();
  return NextResponse.json({
    ok: true,
    creditPackages: s.credit_packages,
    whatsappNumber: (s.whatsapp_number || DEFAULT_WHATSAPP).replace(/\D/g, ""),
    whatsappMessageTemplate: s.whatsapp_message_template,
    buySoftwareUrl: s.buy_software_url || DEFAULT_BUY_SOFTWARE_URL,
    freeSignupCredits: s.free_signup_credits,
    maxFreeQuestions: MAX_FREE_QUESTIONS,
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
  });
}
