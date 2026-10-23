import { NextResponse, after } from "next/server";
import { siteUrl } from "@/lib/config";
import { getWebUser } from "@/lib/googleAuth";
import { parseForm, FormParseError, FORM_ERROR_MESSAGES } from "@/lib/formParser";
import { moderateFormSafe, type QuestionConfigMap } from "@/lib/aiProfiles";
import { claimSlot, getQueuePosition } from "@/lib/queue";
import { db, type WebJob } from "@/lib/db";
import { onlyExisting } from "@/lib/schemaFlags";
import { audit } from "@/lib/audit";
import { recordConsent, TERMS_VERSION } from "@/lib/consent";
import { spendCredits } from "@/lib/credits";
import { rateLimit } from "@/lib/ratelimit";
import {
  SUPPORTED_LANGUAGES,
  MAX_FREE_QUESTIONS,
  MAX_PAID_QUESTIONS,
  MAX_RESPONSES_PER_JOB,
  MAX_RESPONSES_PER_DAY,
  DEFAULT_BUY_SOFTWARE_URL,
  FREE_ACCOUNTS_PER_FORM,
} from "@/lib/webConfig";
import { usage, resolveGlobalCap, type UsageRow } from "@/lib/capacity";
import { pauseState } from "@/lib/queue";
import { getAppSettings } from "@/lib/appSettings";


interface CreateJobBody {
  formUrl?: unknown;
  total?: unknown;
  language?: unknown;
  customInstructions?: unknown;
  qConfig?: unknown;
  acceptedTerms?: unknown;
}


function fail(status: number, payload: Record<string, unknown>) {
  const reason = (payload.reason ?? payload.error) as string | undefined;
  return NextResponse.json({ ok: false, ...payload, reason, error: reason }, { status });
}

/** ID estable del formulario (igual con link largo, corto forms.gle o de edición). */
function formIdOf(viewUrl: string): string | null {
  const m = viewUrl.match(/\/forms\/d\/(?:e\/)?([A-Za-z0-9_-]{10,})/);
  return m ? m[1] : null;
}

/** ¿Alguna vez compró? Créditos comprados en saldo o un pedido pagado. */
async function hasEverPaid(userId: string, credits: number): Promise<boolean> {
  if (credits > 0) return true;
  const { count } = await db()
    .from("web_credit_orders")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "paid");
  return (count ?? 0) > 0;
}

/**
 * Cuántas OTRAS cuentas ya llenaron gratis este formulario (envíos gratis que
 * llegaron a enviar algo o que están en curso). Se compara por el ID del
 * formulario, no por el texto del link.
 */
async function otherFreeAccountsOnForm(formId: string, userId: string): Promise<number> {
  // "_" y "%" son comodines en LIKE: el ID puede traer "_".
  const pattern = `%${formId.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const { data } = await db()
    .from("web_jobs")
    .select("user_id,status,sent")
    .eq("is_paid", false)
    .neq("user_id", userId)
    .like("view_url", pattern)
    .limit(200);
  const users = new Set(
    (data ?? [])
      .filter((j) => j.status === "queued" || j.status === "processing" || (j.sent ?? 0) > 0)
      .map((j) => j.user_id as string)
  );
  return users.size;
}

function sanitizeQConfig(raw: unknown): QuestionConfigMap {
  const out: QuestionConfigMap = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [entry, cfg] of Object.entries(raw as Record<string, unknown>).slice(0, 300)) {
    if (!/^entry\.\d{1,20}$/.test(entry) || !cfg || typeof cfg !== "object") continue;
    const c = cfg as Record<string, unknown>;
    const mode =
      c.mode === "ai" || c.mode === "fixed" || c.mode === "weighted" || c.mode === "list" ? c.mode : "random";
    // Una lista pegada puede ser larga (hasta 1000 líneas); el resto de valores, corto.
    const maxValue = mode === "list" ? 20_000 : 300;
    out[entry] = {
      mode,
      value: typeof c.value === "string" ? c.value.slice(0, maxValue) : "",
      prompt: typeof c.prompt === "string" ? c.prompt.slice(0, 300) : "",
      ...(mode === "weighted" && Array.isArray(c.weights)
        ? { weights: c.weights.slice(0, 60).map((w) => Math.min(100, Math.max(0, Math.round(Number(w) || 0)))) }
        : {}),
      ...(mode === "list" ? { order: c.order === "sequential" ? ("sequential" as const) : ("random" as const) } : {}),
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
  if (!user.termsOk) {
    return fail(403, {
      code: "CONSENT_REQUIRED",
      reason: "Actualizamos los Términos y la Privacidad: acéptalos para seguir usando la herramienta.",
    });
  }

  const pause = await pauseState();
  if (pause.all) {
    return fail(503, {
      code: "SERVICE_PAUSED",
      reason: pause.message || "El servicio está en pausa por mantenimiento. Vuelve en un rato; tu saldo no se tocó.",
    });
  }

  const formUrl = typeof body.formUrl === "string" ? body.formUrl.trim().slice(0, 500) : "";
  if (!formUrl) return fail(400, { code: "INVALID_URL", reason: "Falta el link del formulario." });

  // Regla: un envío a la vez por cuenta. El siguiente formulario entra cuando
  // termina el actual (así nadie acapara la cola con varios a la vez).
  const { data: active } = await db()
    .from("web_jobs")
    .select("id,title,status")
    .eq("user_id", user.id)
    .in("status", ["queued", "processing"])
    .limit(1);
  if (active?.length) {
    return fail(409, {
      code: "ACTIVE_JOB",
      activeJobId: active[0].id,
      reason: `Ya tienes un envío en curso${active[0].title ? ` ("${active[0].title}")` : ""}. Cuando termine podrás enviar otro formulario.`,
    });
  }

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

  // Formularios que piden correo ("Respuesta del usuario"): se envía un
  // correo generado en cada respuesta (ver formSubmitter). Los de correo
  // verificado exigen iniciar sesión y parseForm ya los rechaza (NOT_PUBLIC).

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

  const balances = { credits: user.credits, freeCredits: user.freeCredits };

  if (form.questions.length > MAX_PAID_QUESTIONS) {
    return fail(400, {
      code: "TOO_MANY_QUESTIONS_WEB",
      ...balances,
      buySoftwareUrl: DEFAULT_BUY_SOFTWARE_URL,
      reason: `Tu formulario tiene ${form.questions.length} preguntas y el servicio web llena hasta ${MAX_PAID_QUESTIONS}. Para formularios más grandes usa FormsBot para Windows, sin límite de preguntas.`,
    });
  }

  // ── Límites de volumen (antes de cobrar nada) ─────────────────────
  // Por cuenta y global en 24 h: nadie puede reintentar sin fin ni
  // saturar Google/Vercel, ni siquiera con créditos.
  const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const supaCheck = db();
  const [{ data: mine }, { data: everyone }] = await Promise.all([
    supaCheck.from("web_jobs").select("total,sent,failed,status").eq("user_id", user.id).gte("created_at", since),
    supaCheck.from("web_jobs").select("total,sent,failed,status").gte("created_at", since),
  ]);
  const usedToday = usage(mine as UsageRow[] | null);
  if (usedToday + total > MAX_RESPONSES_PER_DAY) {
    const left = Math.max(0, MAX_RESPONSES_PER_DAY - usedToday);
    return fail(429, {
      code: "DAILY_LIMIT",
      ...balances,
      reason:
        left > 0
          ? `El límite es de ${MAX_RESPONSES_PER_DAY} respuestas cada 24 horas por cuenta. Hoy te quedan ${left}: baja la cantidad o vuelve mañana.`
          : `Llegaste al límite de ${MAX_RESPONSES_PER_DAY} respuestas en 24 horas. Vuelve mañana, o usa FormsBot para Windows si necesitas más volumen.`,
    });
  }
  if (usage(everyone as UsageRow[] | null) + total > (await resolveGlobalCap())) {
    return fail(503, {
      code: "SERVICE_BUSY",
      ...balances,
      reason: "El servicio llegó a su capacidad de hoy. Intenta de nuevo en unas horas; tu saldo no se tocó.",
    });
  }

  // ── Cobro ─────────────────────────────────────────────────────────
  // Gratis (bienvenida): UN solo envío por cuenta, solo aleatorio/fijo y
  // hasta 30 preguntas. Lo que no se use en ese envío se pierde. Cualquier
  // otra cosa se paga completa con créditos comprados (cola prioritaria).
  const usesAi = form.questions.some((q) => (qConfig[q.entry]?.mode ?? "random") === "ai");
  const tooManyQuestions = form.questions.length > MAX_FREE_QUESTIONS;
  let isPaid = usesAi || tooManyQuestions || total > user.freeCredits;

  // Un mismo formulario solo se llena gratis UNA vez. Si ya lo llenó gratis
  // otra cuenta, este envío se cobra con créditos (también a quien ya compró
  // antes); si no le alcanzan, debe comprar más.
  if (!isPaid) {
    // Editable en Admin → Configuración (0 = sin límite); si la columna aún
    // no existe se usa el valor por defecto del código.
    const limit = (await getAppSettings()).free_accounts_per_form ?? FREE_ACCOUNTS_PER_FORM;
    const formId = limit > 0 ? formIdOf(form.viewUrl) : null;
    const others = formId ? await otherFreeAccountsOnForm(formId, user.id) : 0;
    if (formId && others >= limit) {
      if (user.credits >= total) {
        isPaid = true; // se cobra de sus créditos comprados
      } else {
        await audit({
          action: "job.free_form_reused",
          level: "security",
          userId: user.id,
          email: user.email,
          target: formId,
          details: { form_url: formUrl, other_free_accounts: others, credits: user.credits, total },
        });
        const everPaid = await hasEverPaid(user.id, user.credits);
        return fail(402, {
          code: "FORM_FREE_USED",
          ...balances,
          reason:
            user.credits > 0
              ? `Este formulario ya se llenó gratis antes, así que este envío se paga con créditos: necesitas ${total} y te quedan ${user.credits}. Compra más créditos o baja la cantidad a ${user.credits}.`
              : everPaid
                ? `Este formulario ya se llenó gratis antes, así que este envío se paga con créditos y se te acabaron. Compra más créditos para llenarlo.`
                : "Este formulario ya fue llenado gratis desde otra cuenta. El envío gratis es una vez por formulario: compra créditos para seguir llenándolo (además vas en la fila prioritaria y puedes usar IA).",
        });
      }
    }
  }

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
  // El envío gratis consume TODA la bienvenida (no solo `total`): lo que no
  // se use se pierde, así no se puede repartir en muchos envíos pequeños.
  const freeSpend = isPaid ? 0 : user.freeCredits;
  const spent = await spendCredits(user.id, paidSpend, freeSpend).catch((e) => {
    console.error("[jobs] no se pudo descontar saldo:", e);
    return null;
  });
  if (!spent) {
    return fail(409, { code: "BALANCE_CHANGED", ...balances, reason: "Tu saldo cambió mientras enviabas. Recarga la página e intenta de nuevo." });
  }

  const supa = db();
  const row = await onlyExisting(
    "web_jobs",
    {
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
      collects_email: form.collectsEmail,
      last_seen_at: new Date().toISOString(),
    },
    ["collects_email", "last_seen_at"]
  );
  const { data: job, error } = await supa.from("web_jobs").insert(row).select().single<WebJob>();

  if (error || !job) {
    // Devolver lo cobrado: el envío nunca se creó.
    await spendCredits(user.id, -paidSpend, -freeSpend).catch((e) => console.error("[jobs] reembolso fallido:", e));
    console.error("[jobs] no se pudo crear el trabajo:", error?.message);
    return fail(500, { code: "CREATE_FAILED", reason: "No se pudo crear el envío. No se te cobró nada; intenta de nuevo." });
  }

  // Re-chequeo DESPUÉS de insertar: la revisión de arriba no es atómica y
  // varias peticiones simultáneas veían todas "te quedan 500". Ahora cada una
  // ve también a las demás ya insertadas; si entre todas se pasan, esta se
  // anula y se reembolsa (puede rechazar de más, nunca permitir de más).
  const { data: mineAfter } = await supa
    .from("web_jobs")
    .select("total,sent,failed,status")
    .eq("user_id", user.id)
    .gte("created_at", since);
  if (usage(mineAfter as UsageRow[] | null) > MAX_RESPONSES_PER_DAY) {
    const { data: removed } = await supa.from("web_jobs").delete().eq("id", job.id).eq("status", "queued").select("id");
    if (removed?.length) {
      await spendCredits(user.id, -paidSpend, -freeSpend).catch((e) => console.error("[jobs] reembolso fallido:", e));
      return fail(429, {
        code: "DAILY_LIMIT",
        ...balances,
        reason: `El límite es de ${MAX_RESPONSES_PER_DAY} respuestas cada 24 horas por cuenta. No se te cobró este envío.`,
      });
    }
  }

  // Prueba de lo que aceptó para ESTE formulario (link, fecha, IP, navegador).
  await recordConsent(user, "job_use", true, { job_id: job.id, form_url: formUrl, title: job.title, total, is_paid: isPaid });
  await audit({
    action: "job.create",
    userId: user.id,
    email: user.email,
    target: job.id,
    details: { form_url: formUrl, title: job.title, total, is_paid: isPaid, questions: form.questions.length, collects_email: form.collectsEmail },
  });

  const claimedJob = await claimSlot(job);

  // Despertar al worker en la nube: el envío avanza aunque el cliente cierre
  // la pestaña justo después de presionar "Enviar".
  if (process.env.WORKER_SECRET) {
    after(async () => {
      await fetch(`${siteUrl()}/api/web/worker`, {
        method: "POST",
        headers: { Authorization: `Bearer ${(process.env.WORKER_SECRET || "").trim()}` },
        signal: AbortSignal.timeout(3_000),
        cache: "no-store",
      }).catch(() => {});
    });
  }
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
