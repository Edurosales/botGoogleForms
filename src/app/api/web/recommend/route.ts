import { NextResponse } from "next/server";
import { getWebUser } from "@/lib/googleAuth";
import { parseForm, FormParseError, FORM_ERROR_MESSAGES } from "@/lib/formParser";
import { aiRecommendations } from "@/lib/recommend";
import { rateLimit } from "@/lib/ratelimit";

/** Recomendaciones de configuración con IA — solo para quien compró créditos. */
export async function POST(request: Request) {
  const user = await getWebUser();
  if (!user) return NextResponse.json({ ok: false, code: "LOGIN_REQUIRED", reason: "Inicia sesión con Google." }, { status: 401 });
  if (user.credits <= 0) {
    return NextResponse.json(
      { ok: false, code: "AI_REQUIRES_PAID", reason: "Las sugerencias con IA están disponibles con créditos comprados." },
      { status: 402 }
    );
  }
  if (!rateLimit(`web-recommend:${user.id}`, 5, 10 * 60_000)) {
    return NextResponse.json({ ok: false, code: "RATE_LIMITED", reason: "Pediste varias sugerencias seguidas. Espera unos minutos." }, { status: 429 });
  }

  const body = (await request.json().catch(() => ({}))) as { formUrl?: unknown };
  const formUrl = typeof body.formUrl === "string" ? body.formUrl.trim().slice(0, 500) : "";
  if (!formUrl) return NextResponse.json({ ok: false, code: "INVALID_URL", reason: "Falta el link del formulario." }, { status: 400 });

  let form;
  try {
    form = await parseForm(formUrl);
  } catch (e) {
    const code = e instanceof FormParseError ? e.code : "FETCH_FAILED";
    const reason = e instanceof FormParseError ? e.message : FORM_ERROR_MESSAGES.FETCH_FAILED;
    return NextResponse.json({ ok: false, code, reason }, { status: 400 });
  }

  const { recommendations, source } = await aiRecommendations(form);
  return NextResponse.json({ ok: true, source, recommendations });
}
