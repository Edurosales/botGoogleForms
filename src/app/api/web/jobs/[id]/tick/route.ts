import { NextResponse } from "next/server";
import { getWebUser } from "@/lib/googleAuth";
import { db, type FailureDetail, type WebJob } from "@/lib/db";
import { claimSlot, getQueuePosition } from "@/lib/queue";
import { generateProfiles, needsAi } from "@/lib/aiProfiles";
import { failureHint, submitOne, type SubmitResult } from "@/lib/formSubmitter";
import { addCredits, spendCredits } from "@/lib/credits";
import type { ParsedForm, ParsedQuestion } from "@/lib/formParser";

// Generar con Groq y enviar a Google nunca van en la misma invocación: la
// suma se pasaba del tiempo máximo de la función (502 sin rastro).
export const maxDuration = 60;
// Fase de envío (nunca toca Groq): 12 por tick, de a 3 en paralelo.
// Cada envío ≈ GET + 0.2–0.7 s + POST ≈ 1.5 s → ~6 s por tick.
const SUBMIT_BATCH = 12;
const SUBMIT_CONCURRENCY = 3;
const GEN_CHUNK = 6; // perfiles por llamada a Groq (solo si hay preguntas en modo IA)
const MAX_FAILURE_DETAILS = 20;

function jobToForm(job: WebJob): ParsedForm {
  return {
    title: job.title,
    description: "",
    questions: job.questions as ParsedQuestion[],
    viewUrl: job.view_url,
    submitUrl: job.submit_url,
    numSections: job.num_sections,
    collectsEmail: false,
  };
}

/** Devuelve al saldo de origen lo que no se llegó a enviar. */
async function refundUnsent(job: WebJob, unsent: number) {
  if (unsent <= 0) return;
  try {
    if (job.is_paid) await addCredits(job.user_id, unsent);
    else await spendCredits(job.user_id, 0, -unsent);
  } catch (e) {
    console.error(`[tick] reembolso de ${unsent} falló para job ${job.id}:`, e);
  }
}

/** Pasa el job a un estado final una sola vez (aunque haya dos ticks a la vez) y reembolsa. */
async function finishJob(job: WebJob, patch: Partial<WebJob> & { status: WebJob["status"] }) {
  const { data: won } = await db()
    .from("web_jobs")
    .update({ ...patch, finished_at: new Date().toISOString() })
    .eq("id", job.id)
    .eq("status", "processing")
    .select("id")
    .maybeSingle();
  if (won) await refundUnsent(job, job.total - (patch.sent ?? job.sent));
}

async function runPool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
}

function statusPayload(job: WebJob, extra: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: job.status,
    sent: job.sent,
    failed: job.failed,
    total: job.total,
    queuePosition: 0,
    failures: (job.failure_details ?? []).slice(-5),
    ...extra,
  };
}

export async function POST(_req: Request, ctx: RouteContext<"/api/web/jobs/[id]/tick">) {
  const user = await getWebUser();
  if (!user) return NextResponse.json({ ok: false, error: "No autorizado." }, { status: 401 });

  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "No encontrado." }, { status: 404 });

  const supa = db();
  const { data: job } = await supa.from("web_jobs").select("*").eq("id", id).maybeSingle<WebJob>();
  if (!job || job.user_id !== user.id) {
    return NextResponse.json({ ok: false, error: "No encontrado." }, { status: 404 });
  }

  if (job.status === "queued") {
    const claimed = await claimSlot(job);
    const queuePosition = await getQueuePosition(claimed);
    return NextResponse.json(statusPayload(claimed, { queuePosition }));
  }

  if (job.status !== "processing") {
    return NextResponse.json(statusPayload(job, { reason: job.moderation_reason || undefined }));
  }

  const form = jobToForm(job);
  const aiInvolved = needsAi(form.questions, job.q_config);

  // ── Fase 1: generar perfiles ───────────────────────────────────────
  const generatedSoFar = job.profiles ?? [];
  if (generatedSoFar.length < job.total) {
    const remaining = job.total - generatedSoFar.length;
    // Sin IA no hay límite de Groq que respetar: se genera todo de una vez.
    const chunkSize = aiInvolved ? Math.min(GEN_CHUNK, remaining) : remaining;
    let chunk;
    try {
      chunk = await generateProfiles(form, {
        nProfiles: chunkSize,
        qConfig: job.q_config,
        language: job.language,
        customInstructions: job.custom_instructions,
      });
    } catch (e) {
      const reason = e instanceof Error ? e.message : "Fallo generando respuestas";
      console.error(`[tick] generateProfiles falló para job ${job.id}:`, reason);
      const friendly = /429|rate limit|tokens per/i.test(reason)
        ? "La IA está saturada en este momento. Se te devolvieron los créditos: intenta de nuevo en unos minutos o usa Aleatorio/Fijo."
        : "No se pudieron generar las respuestas con IA. Se te devolvieron los créditos; intenta de nuevo.";
      await finishJob(job, { status: "failed", moderation_reason: friendly });
      return NextResponse.json({ ok: false, error: friendly, reason: friendly }, { status: 502 });
    }
    const profiles = [...generatedSoFar, ...chunk].slice(0, job.total);
    await supa.from("web_jobs").update({ profiles }).eq("id", job.id);
    return NextResponse.json(statusPayload(job, { phase: "generating", generated: profiles.length }));
  }

  // ── Fase 2: enviar a Google ────────────────────────────────────────
  const alreadyDone = job.sent + job.failed;
  const batch = generatedSoFar.slice(alreadyDone, alreadyDone + SUBMIT_BATCH);

  const results: SubmitResult[] = await runPool(batch, SUBMIT_CONCURRENCY, (profile) => submitOne(form, profile));

  let sent = job.sent;
  let failed = job.failed;
  const failures: FailureDetail[] = [...(job.failure_details ?? [])];
  results.forEach((r, i) => {
    if (r.ok) {
      sent++;
      return;
    }
    failed++;
    failures.push({
      index: alreadyDone + i + 1,
      status: r.status,
      question: r.detail?.question ?? "",
      message: r.detail?.message ?? `Google respondió ${r.status || "sin conexión"}`,
      hint: failureHint(form, r),
    });
  });
  const failureDetails = failures.slice(-MAX_FAILURE_DETAILS);

  const finished = sent + failed >= job.total;
  if (finished) {
    const status = sent === 0 ? "failed" : "done";
    await finishJob(job, {
      status,
      sent,
      failed,
      failure_details: failureDetails,
      ...(sent === 0 && failureDetails.length
        ? { moderation_reason: `Google rechazó todas las respuestas. ${failureDetails[failureDetails.length - 1].hint}` }
        : {}),
    });
    const reason =
      sent === 0 && failureDetails.length
        ? `Google rechazó todas las respuestas. ${failureDetails[failureDetails.length - 1].hint}`
        : undefined;
    return NextResponse.json(
      statusPayload({ ...job, status, sent, failed, failure_details: failureDetails }, { reason, refunded: job.total - sent })
    );
  }

  await supa.from("web_jobs").update({ sent, failed, failure_details: failureDetails }).eq("id", job.id).eq("status", "processing");
  return NextResponse.json(statusPayload({ ...job, sent, failed, failure_details: failureDetails }, { phase: "sending" }));
}
