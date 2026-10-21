import { NextResponse, connection } from "next/server";
import { getAppSettings } from "@/lib/appSettings";
import { DEFAULT_BUY_SOFTWARE_URL, DEFAULT_WHATSAPP, MAX_FREE_QUESTIONS } from "@/lib/webConfig";

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
  });
}
