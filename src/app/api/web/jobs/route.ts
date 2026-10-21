import { NextResponse } from "next/server";
import { getWebUser } from "@/lib/googleAuth";
import { parseForm, FormParseError, FORM_ERROR_MESSAGES } from "@/lib/formParser";
import { moderateFormSafe, type QuestionConfigMap } from "@/lib/aiProfiles";
import { claimSlot, getQueuePosition } from "@/lib/queue";
import { db, type WebJob } from "@/lib/db";
import { spendCredits } from "@/lib/credits";
import { rateLimit } from "@/lib/ratelimit";
import { SUPPORTED_LANGUAGES, MAX_FREE_QUESTIONS, MAX_RESPONSES_PER_JOB } from "@/lib/webConfig";

interface CreateJobBody {
  formUrl?: unknown;
  total?: unknown;
  language?: unknown;
  customInstructions?: unknown;
  qConfig?: unknown;
  acceptedTerms?: unknown;
}

const TERMS_VERSION = "2026-10-20";

function fail(status: number, payload: Record<string, unknown>) {
  const reason = (payload.reason ?? payload.error) as string | undefined;
  return NextResponse.json({ ok: false, ...payload, reason, error: reason }, { status });
}

function sanitizeQConfig(raw: unknown): QuestionConfigMap {
  const out: QuestionConfigMap = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [entry, cfg] of Object.entries(raw as Record<string, unknown>).slice(0, 300)) {
    if (!/^entry\.\d{1,20}$/.test(entry) || !cfg || typeof cfg !== "object") continue;
    const c = cfg as Record<string, unknown>;
    out[entry] = {
      mode: c.mode === "ai" || c.mode === "fixed" ? c.mode : "random",
      value: typeof c.value === "string" ? c.value.slice(0, 300) : "",
      prompt: typeof c.prompt === "string" ? c.prompt.slice(0, 300) : "",
    };
  }
  return out;
}

export async function POST(request: Request) {
  const user = await getWebUser();
  if (!user) return fail(401, { code: "LOGIN_REQUIRED", reason: "Debes iniciar sesión con Google." });

  if (!rateLimit(`web-jobs:${user.id}`, 6, 10 * 60_000)) {
    return fail(429, { code: "RATE_LIMITED", reason: "Creaste varios envíos seguidos. Espera unos minutos." });
  }

  let body: CreateJobBody;
  try {
    body = await request.json();
  } catch {
    return fail(400, { code: "BAD_REQUEST", reason: "Solicitud inválida." });
  }

  if (body.acceptedTerms !== true) {
    return fail(400, { code: "TERMS_REQUIRED", reason: "Debes aceptar los términos del servicio." });
  }

  const formUrl = typeof body.formUrl === "string" ? body.formUrl.trim().slice(0, 500) : "";
  if (!formUrl) return fail(400, { code: "INVALID_URL", reason: "Falta el link del formulario." });

  // Todo texto libre termina en el prompt de Groq o en la BD: se acota.
  const customInstructions = typeof body.customInstructions === "string" ? body.customInstructions.slice(0, 600) : "";
  const language = SUPPORTED_LANGUAGES.some((l) => l.code === body.language)
    ? (body.language as string)
    : SUPPORTED_LANGUAGES[0].code;
  const qConfig = sanitizeQConfig(body.qConfig);
  const total = Math.min(MAX_RESPONSES_PER_JOB, Math.max(1, Math.floor(Number(body.total) || 1)));

  // Re-validar todo en el servidor: nunca confiar en lo que manda el cliente.
  let form;
  try {
    form = await parseForm(formUrl);
  } catch (e) {
    if (e instanceof FormParseError) return fail(400, { code: e.code, reason: e.message });
    return fail(502, { code: "FETCH_FAILED", reason: FORM_ERROR_MESSAGES.FETCH_FAILED });
  }

  if (form.collectsEmail) {
    return fail(400, { code: "COLLECTS_EMAIL", blocked: true, reason: FORM_ERROR_MESSAGES.COLLECTS_EMAIL });
  }

  const moderation = await moderateFormSafe(form);
  if (!moderation.allowed) {
    return fail(400, {
      code: "BLOCKED_CONTENT",
      blocked: true,
      reason: moderation.reason || "Este formulario no puede ser procesado por nuestras políticas de uso.",
    });
  }

  // Toda pregunta sin configurar queda en "random": el generador trata la
  // ausencia de modo como "ai", y así un envío gratis nunca gasta Groq.
  for (const q of form.questions) {
    if (!qConfig[q.entry]) qConfig[q.entry] = { mode: "random", value: "", prompt: "" };
  }

  // ── Cobro ─────────────────────────────────────────────────────────
  // Gratis (créditos de bienvenida): solo aleatorio/fijo, hasta 30
  // preguntas y si alcanzan los créditos gratis. Cualquier otra cosa se
  // paga completa con créditos comprados (y va a la cola prioritaria).
  const usesAi = form.questions.some((q) => (qConfig[q.entry]?.mode ?? "random") === "ai");
  const tooManyQuestions = form.questions.length > MAX_FREE_QUESTIONS;
  const isPaid = usesAi || tooManyQuestions || total > user.freeCredits;
  const balances = { credits: user.credits, freeCredits: user.freeCredits };

  if (isPaid && user.credits < total) {
    if (usesAi) {
      return fail(402, {
        code: "AI_REQUIRES_PAID",
        ...balances,
        reason: `Las respuestas con IA usan créditos comprados: este envío necesita ${total} y tienes ${user.credits}. Compra créditos o cambia esas preguntas a Aleatorio o Fijo.`,
      });
    }
    if (tooManyQuestions) {
      return fail(402, {
        code: "TOO_MANY_QUESTIONS",
        ...balances,
        reason: `Tu formulario tiene ${form.questions.length} preguntas y el máximo con respuestas gratis es ${MAX_FREE_QUESTIONS}. Necesitas ${total} créditos comprados (tienes ${user.credits}).`,
      });
    }
    return fail(402, {
      code: "NO_CREDITS",
      ...balances,
      reason:
        user.freeCredits > 0
          ? `Te quedan ${user.freeCredits} respuestas gratis y pediste ${total}. Baja la cantidad a ${user.freeCredits} o compra créditos.`
          : `Necesitas ${total} créditos y tienes ${user.credits}. Compra créditos para continuar.`,
    });
  }

  const paidSpend = isPaid ? total : 0;
  const freeSpend = isPaid ? 0 : total;
  const spent = await spendCredits(user.id, paidSpend, freeSpend).catch((e) => {
    console.error("[jobs] no se pudo descontar saldo:", e);
    return null;
  });
  if (!spent) {
    return fail(409, { code: "BALANCE_CHANGED", ...balances, reason: "Tu saldo cambió mientras enviabas. Recarga la página e intenta de nuevo." });
  }

  const supa = db();
  const { data: job, error } = await supa
    .from("web_jobs")
    .insert({
      user_id: user.id,
      form_url: formUrl,
      view_url: form.viewUrl,
      submit_url: form.submitUrl,
      title: form.title.slice(0, 300),
      num_sections: form.numSections,
      questions: form.questions,
      total,
      language,
      custom_instructions: customInstructions,
      q_config: qConfig,
      is_paid: isPaid,
      credits_spent: paidSpend,
      free_credits_spent: freeSpend,
      terms_version: TERMS_VERSION,
      terms_accepted_at: new Date().toISOString(),
    })
    .select()
    .single<WebJob>();

  if (error || !job) {
    // Devolver lo cobrado: el envío nunca se creó.
    await spendCredits(user.id, -paidSpend, -freeSpend).catch((e) => console.error("[jobs] reembolso fallido:", e));
    console.error("[jobs] no se pudo crear el trabajo:", error?.message);
    return fail(500, { code: "CREATE_FAILED", reason: "No se pudo crear el envío. No se te cobró nada; intenta de nuevo." });
  }

  const claimedJob = await claimSlot(job);
  const queuePosition = await getQueuePosition(claimedJob);

  return NextResponse.json({
    ok: true,
    jobId: claimedJob.id,
    status: claimedJob.status,
    queuePosition,
    isPaid,
    credits: spent.credits,
    freeCredits: spent.free_credits,
  });
}

/** Últimos 20 envíos del usuario (para "Mi cuenta"). */
export async function GET() {
  const user = await getWebUser();
  if (!user) return fail(401, { code: "LOGIN_REQUIRED", reason: "Debes iniciar sesión con Google." });
  const { data } = await db()
    .from("web_jobs")
    .select("id,title,total,sent,failed,status,is_paid,created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20);
  return NextResponse.json({ ok: true, jobs: data ?? [] });
}
