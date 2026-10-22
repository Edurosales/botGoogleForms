import { NextResponse } from "next/server";
import { parseForm, FormParseError, FORM_ERROR_MESSAGES } from "@/lib/formParser";
import { heuristicModeration, moderateFormSafe } from "@/lib/aiProfiles";
import { heuristicRecommendations } from "@/lib/recommend";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { getWebUser } from "@/lib/googleAuth";
import { MAX_FREE_QUESTIONS, MAX_PAID_QUESTIONS } from "@/lib/webConfig";

function err(code: string, reason: string, status = 400, extra: Record<string, unknown> = {}) {
  // `error` se mantiene por compatibilidad con la UI anterior.
  return NextResponse.json({ ok: false, code, reason, error: reason, ...extra }, { status });
}

export async function POST(request: Request) {
  const user = await getWebUser().catch(() => null);
  const who = user ? `u:${user.id}` : `ip:${clientIp(request)}`;
  if (!rateLimit(`web-parse:${who}`, 20, 10 * 60_000)) {
    return err("RATE_LIMITED", "Demasiados intentos seguidos. Espera unos minutos y vuelve a probar.", 429);
  }

  let body: { url?: unknown };
  try {
    body = await request.json();
  } catch {
    return err("INVALID_URL", "Solicitud inválida.");
  }

  const url = typeof body.url === "string" ? body.url.trim().slice(0, 500) : "";
  if (!url) return err("INVALID_URL", "Pega el link de tu Google Form.");

  let form;
  try {
    form = await parseForm(url);
  } catch (e) {
    if (e instanceof FormParseError) return err(e.code, e.message);
    console.error("[parse] error inesperado:", e);
    return err("FETCH_FAILED", FORM_ERROR_MESSAGES.FETCH_FAILED, 502);
  }


  // Sin sesión, solo la revisión local por palabras clave: si no, cualquiera
  // podría repetir lecturas anónimas y agotar la cuota diaria de Groq que
  // usan los clientes que pagan. La revisión con IA se repite igual al crear
  // el envío (con sesión y con su propio límite).
  const moderation = user ? await moderateFormSafe(form) : heuristicModeration(form);
  if (!moderation.allowed) {
    return err(
      "BLOCKED_CONTENT",
      moderation.reason || "Este formulario parece ser un concurso, sorteo, votación u otra actividad que no podemos procesar.",
      400,
      { blocked: true }
    );
  }

  if (form.questions.length > MAX_PAID_QUESTIONS) {
    return err(
      "TOO_MANY_QUESTIONS_WEB",
      `Tu formulario tiene ${form.questions.length} preguntas y el servicio web llena hasta ${MAX_PAID_QUESTIONS}. Para formularios más grandes usa FormsBot para Windows, sin límite de preguntas.`,
      400
    );
  }

  const warnings: { code: string; message: string }[] = [];
  if (form.questions.length > MAX_FREE_QUESTIONS) {
    warnings.push({
      code: "TOO_MANY_QUESTIONS_FREE",
      message: `Tu formulario tiene ${form.questions.length} preguntas. Con respuestas gratis el máximo es ${MAX_FREE_QUESTIONS}: para enviarlo necesitas créditos comprados.`,
    });
  }
  const required = form.questions.filter((q) => q.required).length;
  if (form.numSections > 1) {
    warnings.push({
      code: "MULTI_SECTION",
      message: `Tu formulario tiene ${form.numSections} secciones. Si alguna sección se salta según una respuesta, configura esa pregunta como Fijo para que todas las respuestas sigan el mismo camino.`,
    });
  }

  return NextResponse.json({
    ok: true,
    form: {
      title: form.title,
      description: form.description,
      numSections: form.numSections,
      requiredCount: required,
      questions: form.questions.map((q) => ({
        entry: q.entry,
        title: q.title,
        type: q.type,
        typeName: q.typeName,
        options: q.options,
        required: q.required,
        validation: q.validation ?? null,
      })),
    },
    warnings,
    recommendations: heuristicRecommendations(form),
    limits: { maxFreeQuestions: MAX_FREE_QUESTIONS },
  });
}
