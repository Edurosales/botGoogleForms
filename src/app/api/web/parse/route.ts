import { NextResponse } from "next/server";
import { parseForm, FormParseError, FORM_ERROR_MESSAGES } from "@/lib/formParser";
import { heuristicModeration, moderateFormSafe } from "@/lib/aiProfiles";
import { heuristicRecommendations } from "@/lib/recommend";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { getWebUser } from "@/lib/googleAuth";
import { FREE_ACCOUNTS_PER_FORM, MAX_FREE_QUESTIONS, MAX_PAID_QUESTIONS } from "@/lib/webConfig";
import { limitsFor } from "@/lib/limits";
import { getAppSettings } from "@/lib/appSettings";
import { db } from "@/lib/db";
import { formIdOf } from "@/lib/formId";

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

  const settings = await getAppSettings();
  const lim = user
    ? await limitsFor(user.email)
    : { maxPaidQuestions: settings.max_paid_questions ?? MAX_PAID_QUESTIONS, maxFreeQuestions: settings.max_free_questions ?? MAX_FREE_QUESTIONS };
  if (form.questions.length > lim.maxPaidQuestions) {
    return err(
      "TOO_MANY_QUESTIONS_WEB",
      `Tu formulario tiene ${form.questions.length} preguntas y el servicio web llena hasta ${lim.maxPaidQuestions}. Para formularios más grandes usa FormsBot para Windows, sin límite de preguntas.`,
      400
    );
  }

  const warnings: { code: string; message: string }[] = [];
  if (form.questions.length > lim.maxFreeQuestions) {
    warnings.push({
      code: "TOO_MANY_QUESTIONS_FREE",
      message: `Tu formulario tiene ${form.questions.length} preguntas. Con respuestas gratis el máximo es ${lim.maxFreeQuestions}: para enviarlo necesitas créditos comprados.`,
    });
  }

  // Este formulario ya usó su envío gratis (desde otra cuenta): se avisa ANTES
  // de configurar, no al final.
  const formId = formIdOf(form.viewUrl);
  const freeLimit = settings.free_accounts_per_form ?? FREE_ACCOUNTS_PER_FORM;
  if (formId && freeLimit > 0) {
    const pattern = `%${formId.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const { data: freeJobs } = await db()
      .from("web_jobs")
      .select("user_id,status,sent")
      .eq("is_paid", false)
      .like("view_url", pattern)
      .limit(200);
    const others = new Set(
      (freeJobs ?? [])
        .filter((j) => (j.status === "queued" || j.status === "processing" || (j.sent ?? 0) > 0) && j.user_id !== user?.id)
        .map((j) => j.user_id as string)
    );
    if (others.size >= freeLimit) {
      warnings.push({
        code: "FORM_FREE_USED",
        message:
          "Este formulario ya fue respondido con un envío gratis. Para enviarle más respuestas necesitas créditos comprados (cualquier paquete). Si ya compraste, se descuentan de tus créditos.",
      });
    }
  }

  // La última configuración que esta persona usó con este mismo formulario:
  // se aplica sola al volver a pegar el link.
  let lastConfig: Record<string, unknown> | null = null;
  if (user && formId) {
    const pattern = `%${formId.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const { data: last } = await db()
      .from("web_jobs")
      .select("q_config,total,language,custom_instructions,created_at")
      .eq("user_id", user.id)
      .like("view_url", pattern)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last?.q_config && Object.keys(last.q_config as object).length) {
      lastConfig = {
        qConfig: last.q_config,
        total: last.total,
        language: last.language,
        customInstructions: last.custom_instructions ?? "",
        usedAt: last.created_at,
      };
    }
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
      formId: formIdOf(form.viewUrl),
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
    limits: { maxFreeQuestions: lim.maxFreeQuestions, maxPaidQuestions: lim.maxPaidQuestions },
    lastConfig,
  });
}
