import { NextResponse } from "next/server";
import { parseForm, FormParseError, FORM_ERROR_MESSAGES } from "@/lib/formParser";
import { moderateFormSafe } from "@/lib/aiProfiles";
import { heuristicRecommendations } from "@/lib/recommend";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { getWebUser } from "@/lib/googleAuth";
import { FREE_ACCOUNTS_PER_FORM, MAX_FREE_QUESTIONS, MAX_PAID_QUESTIONS } from "@/lib/webConfig";
import { limitsFor } from "@/lib/limits";
import { getAppSettings } from "@/lib/appSettings";
import { formIdOf } from "@/lib/formId";
import { freeAccountsOnForm, lastJobOnForm } from "@/lib/formJobs";

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

  // Solo pago (panel → Control del servicio): leer un formulario exige créditos.
  // Se corta ANTES de descargar nada de Google (no gasta servidor).
  const early = await getAppSettings();
  if (early.paid_only && !(user && user.credits > 0)) {
    return err(
      "PAID_ONLY",
      user ? "En este momento FormsBot funciona solo con créditos. Compra un paquete y tu formulario se lee y se envía al instante, sin fila." : "Inicia sesión y compra créditos para leer tu formulario.",
      402,
      { paidOnly: true, reasonKey: user ? "PAID_ONLY" : "LOGIN_PAID" }
    );
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


  // Revisión local instantánea (sin IA). Lo que no depende entre sí va a la vez,
  // incluidas las dos consultas por formulario (antes iban una tras otra).
  const moderation = moderateFormSafe(form);
  const formId = formIdOf(form.viewUrl);
  const [settings, userLimits, last] = await Promise.all([
    getAppSettings(),
    user ? limitsFor(user.email) : Promise.resolve(null),
    user && formId ? lastJobOnForm(formId, user.id) : Promise.resolve(null),
  ]);
  if (!moderation.allowed) {
    return err(
      "BLOCKED_CONTENT",
      moderation.reason || "Este formulario parece ser un concurso, sorteo, votación u otra actividad que no podemos procesar.",
      400,
      { blocked: true }
    );
  }

  const lim = userLimits
    ? userLimits
    : { maxPaidQuestions: settings.max_paid_questions ?? MAX_PAID_QUESTIONS, maxFreeQuestions: settings.max_free_questions ?? MAX_FREE_QUESTIONS };
  if (form.questions.length > lim.maxPaidQuestions) {
    return err(
      "TOO_MANY_QUESTIONS_WEB",
      `Tu formulario tiene ${form.questions.length} preguntas y el servicio web llena hasta ${lim.maxPaidQuestions}. Para formularios más grandes usa FormsBot para Windows, sin límite de preguntas.`,
      400
    );
  }

  const warnings: { code: string; message: string }[] = [];
  // El tope de preguntas gratis no aplica a quien tiene créditos (comprados o
  // regalados): antes se le seguía avisando aunque ya hubiera comprado.
  if (form.questions.length > lim.maxFreeQuestions && !(user && user.credits > 0)) {
    warnings.push({
      code: "TOO_MANY_QUESTIONS_FREE",
      message: `Tu formulario tiene ${form.questions.length} preguntas. Con respuestas gratis el máximo es ${lim.maxFreeQuestions}: para enviarlo necesitas créditos comprados.`,
    });
  }

  // Este formulario ya usó su envío gratis (desde otra cuenta): se avisa ANTES
  // de configurar, no al final. Quien ya tiene créditos (comprados o regalados)
  // no necesita el aviso: el envío se cobra de sus créditos sin problema.
  const freeLimit = settings.free_accounts_per_form ?? FREE_ACCOUNTS_PER_FORM;
  if (formId && freeLimit > 0 && !(user && user.credits > 0) && (await freeAccountsOnForm(formId, user?.id)) >= freeLimit) {
    warnings.push({
      code: "FORM_FREE_USED",
      message:
        "Este formulario ya fue respondido con un envío gratis. Para enviarle más respuestas necesitas créditos comprados (cualquier paquete). Si ya compraste, se descuentan de tus créditos.",
    });
  }

  // La última configuración que esta persona usó con este mismo formulario:
  // se aplica sola al volver a pegar el link.
  const lastConfig =
    last?.q_config && Object.keys(last.q_config as object).length
      ? {
          qConfig: last.q_config,
          total: last.total,
          language: last.language,
          customInstructions: last.custom_instructions ?? "",
          usedAt: last.created_at,
        }
      : null;
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
      formId,
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
        section: q.section ?? 1,
        jumps: q.jumps ?? null,
      })),
    },
    warnings,
    recommendations: heuristicRecommendations(form),
    limits: { maxFreeQuestions: lim.maxFreeQuestions, maxPaidQuestions: lim.maxPaidQuestions },
    lastConfig,
  });
}
