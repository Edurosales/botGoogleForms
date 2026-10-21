import { NextResponse } from "next/server";
import { getWebUser } from "@/lib/googleAuth";
import { parseForm, FormParseError } from "@/lib/formParser";
import { moderateForm, type QuestionConfigMap } from "@/lib/aiProfiles";
import { getAppSettings } from "@/lib/appSettings";
import { claimSlot, getQueuePosition } from "@/lib/queue";
import { db, type WebJob } from "@/lib/db";
import { SUPPORTED_LANGUAGES } from "@/lib/webConfig";

interface CreateJobBody {
  formUrl?: string;
  total?: number;
  language?: string;
  customInstructions?: string;
  qConfig?: QuestionConfigMap;
  acceptedTerms?: boolean;
}

const TERMS_VERSION = "2026-10-20";
const MAX_QUESTIONS_FREE = 30;

export async function POST(request: Request) {
  const user = await getWebUser();
  if (!user) return NextResponse.json({ ok: false, error: "Debes iniciar sesión con Google." }, { status: 401 });

  let body: CreateJobBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Solicitud inválida." }, { status: 400 });
  }

  if (!body.acceptedTerms) {
    return NextResponse.json({ ok: false, error: "Debes aceptar los términos del servicio." }, { status: 400 });
  }

  const formUrl = (body.formUrl ?? "").trim().slice(0, 500);
  if (!formUrl) return NextResponse.json({ ok: false, error: "Falta el link del formulario." }, { status: 400 });

  // Cualquier texto libre que el usuario escribe termina en el prompt de
  // Groq o guardado en la BD — se acota el tamaño para que nadie pueda
  // inflar el costo de IA o el almacenamiento con un payload gigante.
  const customInstructions = (body.customInstructions ?? "").slice(0, 600);
  const language = SUPPORTED_LANGUAGES.some((l) => l.code === body.language) ? body.language! : SUPPORTED_LANGUAGES[0].code;
  const rawQConfig = body.qConfig || {};
  const qConfig: QuestionConfigMap = {};
  for (const [entry, cfg] of Object.entries(rawQConfig)) {
    if (!cfg || typeof cfg !== "object") continue;
    qConfig[entry] = {
      mode: cfg.mode === "ai" || cfg.mode === "fixed" ? cfg.mode : "random",
      value: typeof cfg.value === "string" ? cfg.value.slice(0, 300) : "",
      prompt: typeof cfg.prompt === "string" ? cfg.prompt.slice(0, 300) : "",
    };
  }

  const settings = await getAppSettings();
  const maxFree = settings.free_daily_cap || 30;
  const maxPaid = Math.max(...settings.credit_packages.map((p) => p.responses), maxFree, 500);
  const total = Math.min(maxPaid, Math.max(1, Math.floor(body.total ?? maxFree)));
  const isPaid = total > maxFree;

  // Re-validar todo en el servidor: nunca confiar en el estado que manda el cliente.
  let form;
  try {
    form = await parseForm(formUrl);
  } catch (e) {
    const message = e instanceof FormParseError ? e.message : "No se pudo leer el formulario.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }

  if (form.collectsEmail) {
    return NextResponse.json(
      {
        ok: false,
        blocked: true,
        reason:
          "Este formulario exige una cuenta de Google con sesión iniciada para recolectar el correo verificado del encuestado. Ese dato no se puede simular: desactiva la recolección de correo en tu formulario (Configuración → Respuestas).",
      },
      { status: 400 }
    );
  }

  if (!isPaid && form.questions.length > MAX_QUESTIONS_FREE) {
    return NextResponse.json(
      {
        ok: false,
        needsCredits: true,
        reason: `Este formulario tiene ${form.questions.length} preguntas. El máximo gratuito es ${MAX_QUESTIONS_FREE} preguntas — compra créditos para formularios más grandes.`,
      },
      { status: 402 }
    );
  }

  const usesAi = form.questions.some((q) => (qConfig[q.entry]?.mode ?? "ai") === "ai");
  if (!isPaid && usesAi) {
    return NextResponse.json(
      {
        ok: false,
        needsCredits: true,
        reason:
          'Las respuestas generadas con IA solo están disponibles con créditos. Cambia esas preguntas a "aleatorio" o "fijo", o compra créditos para esta tanda.',
      },
      { status: 402 }
    );
  }

  const moderation = await moderateForm(form).catch(() => ({ allowed: false, reason: "" }));
  if (!moderation.allowed) {
    return NextResponse.json(
      { ok: false, blocked: true, reason: moderation.reason || "Este formulario no puede ser procesado por nuestras políticas de uso." },
      { status: 400 }
    );
  }

  const supa = db();

  if (isPaid) {
    // Claim atómico de créditos: solo descuenta si el saldo sigue siendo el que leímos.
    const { data: userRow } = await supa.from("web_users").select("credits").eq("id", user.id).single<{ credits: number }>();
    const credits = userRow?.credits ?? 0;
    if (credits < total) {
      return NextResponse.json(
        { ok: false, needsCredits: true, reason: `Necesitas ${total} créditos y tienes ${credits}. Compra créditos para continuar.` },
        { status: 402 }
      );
    }
    const { data: claimed } = await supa
      .from("web_users")
      .update({ credits: credits - total })
      .eq("id", user.id)
      .eq("credits", credits)
      .select()
      .maybeSingle();
    if (!claimed) {
      return NextResponse.json({ ok: false, error: "Tu saldo cambió, intenta de nuevo." }, { status: 409 });
    }
  }

  const { data: job, error } = await supa
    .from("web_jobs")
    .insert({
      user_id: user.id,
      form_url: formUrl,
      view_url: form.viewUrl,
      submit_url: form.submitUrl,
      title: form.title,
      num_sections: form.numSections,
      questions: form.questions,
      total,
      language,
      custom_instructions: customInstructions,
      q_config: qConfig,
      is_paid: isPaid,
      credits_spent: isPaid ? total : 0,
      terms_version: TERMS_VERSION,
      terms_accepted_at: new Date().toISOString(),
    })
    .select()
    .single<WebJob>();

  if (error || !job) {
    return NextResponse.json({ ok: false, error: error?.message || "No se pudo crear el trabajo." }, { status: 500 });
  }

  const claimedJob = await claimSlot(job);
  const queuePosition = await getQueuePosition(claimedJob);

  return NextResponse.json({ ok: true, jobId: claimedJob.id, status: claimedJob.status, queuePosition });
}
