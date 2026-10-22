/**
 * Avance de un envío (job), compartido por el navegador (/jobs/[id]/tick) y
 * el worker en la nube (/api/web/worker). Una sola fuente de verdad: el
 * envío sigue aunque el cliente cierre la pestaña.
 *
 * Generar con Groq y enviar a Google nunca van en la misma invocación: la
 * suma se pasaba del tiempo máximo de la función (502 sin rastro).
 */
import { db, type FailureCode, type FailureDetail, type WebJob } from "./db";
import { claimSlot, getQueuePosition } from "./queue";
import { generateProfiles, needsAi } from "./aiProfiles";
import { failureCode, failureHint, submitOne, type SubmitResult } from "./formSubmitter";
import { addCredits, spendCredits } from "./credits";
import type { ParsedForm, ParsedQuestion } from "./formParser";
import { notifyUser } from "./notify";
import { hasColumn, onlyExisting } from "./schemaFlags";
import { audit } from "./audit";
import { escapeHtml, sendServiceEmail } from "./mailer";
import { siteUrl } from "./config";

// Fase de envío (nunca toca Groq): 12 por tick, de a 3 en paralelo.
const SUBMIT_BATCH = 12;
const SUBMIT_CONCURRENCY = 3;
const GEN_CHUNK = 6; // perfiles por llamada a Groq (solo si hay preguntas en modo IA)
const MAX_FAILURE_DETAILS = 20;
// No se empiezan envíos nuevos pasado este tiempo: lo que ya arrancó termina
// dentro de sus timeouts (6 s GET + 0.7 s + 12 s POST).
const SUBMIT_BUDGET_MS = 30_000;
// Un envío que lleva esto SIN AVANZAR quedó trabado: se cierra y reembolsa.
// (Antes se medía desde que empezó: un envío grande y sano se cortaba.)
const STUCK_WITHOUT_PROGRESS_MS = 15 * 60_000;
// Si la columna progress_at aún no existe, se mide desde que empezó con más margen.
const STUCK_FALLBACK_MS = 60 * 60_000;
const LOCK_MS = 55_000;
// Corte rápido: si los primeros intentos fallan TODOS, no tiene sentido seguir
// (el formulario no es público, pide algo que no podemos dar…): se detiene,
// se explica y se reembolsa en vez de hacer esperar al cliente.
const FAIL_FAST_AFTER = 6;

export type AdvanceResult = { httpStatus: number; body: Record<string, unknown> };

function jobToForm(job: WebJob): ParsedForm {
  return {
    title: job.title,
    description: "",
    questions: job.questions as ParsedQuestion[],
    viewUrl: job.view_url,
    submitUrl: job.submit_url,
    numSections: job.num_sections,
    collectsEmail: job.collects_email ?? false,
  };
}

/**
 * Reembolso al cerrar un job:
 * - Pagado: se devuelven las respuestas no enviadas (rechazadas o sin intentar).
 * - Gratis: la bienvenida es UN solo envío. Si no llegó NINGUNA respuesta
 *   (Google rechazó todo, IA caída, envío trabado) se devuelve completa para
 *   que pueda arreglar su formulario y reintentar: no obtuvo nada. Si llegó
 *   al menos una, la bienvenida se usó y lo demás se pierde.
 */
async function refundOnFinish(job: WebJob, sent: number) {
  try {
    if (job.is_paid) {
      const unsent = job.total - sent;
      if (unsent > 0) await addCredits(job.user_id, unsent);
    } else if (sent === 0 && job.free_credits_spent > 0) {
      await spendCredits(job.user_id, 0, -job.free_credits_spent);
    }
  } catch (e) {
    console.error(`[job] reembolso falló para job ${job.id}:`, e);
  }
}

/** Lo que `refundOnFinish` devolvería (para informarlo en la respuesta). */
function refundAmount(job: WebJob, sent: number): number {
  if (job.is_paid) return Math.max(0, job.total - sent);
  return sent === 0 ? job.free_credits_spent : 0;
}

/** La causa más repetida entre los rechazos (para la ventana de ayuda). */
function mainFailCode(failures: FailureDetail[]): FailureCode | null {
  const counts = new Map<FailureCode, number>();
  for (const f of failures) if (f.code) counts.set(f.code, (counts.get(f.code) ?? 0) + 1);
  let best: FailureCode | null = null;
  for (const [code, n] of counts) if (!best || n > (counts.get(best) ?? 0)) best = code;
  return best;
}

/** Pasa el job a un estado final una sola vez (aunque haya dos ticks a la vez) y reembolsa. */
async function finishJob(job: WebJob, patch: Partial<WebJob> & { status: WebJob["status"] }) {
  const safePatch = await onlyExisting("web_jobs", { ...patch, finished_at: new Date().toISOString() }, ["fail_code"]);
  const { data: won } = await db()
    .from("web_jobs")
    .update(safePatch)
    .eq("id", job.id)
    .eq("status", "processing")
    .select("id")
    .maybeSingle();
  if (!won) return;
  const sent = patch.sent ?? job.sent;
  const failed = patch.failed ?? job.failed;
  await refundOnFinish(job, sent);
  const back = refundAmount(job, sent);
  await audit({
    action: patch.status === "done" ? "job.done" : "job.failed",
    level: patch.status === "done" ? "info" : "warn",
    userId: job.user_id,
    target: job.id,
    details: {
      title: job.title,
      total: job.total,
      sent,
      failed,
      refunded: back,
      is_paid: job.is_paid,
      fail_code: patch.fail_code ?? null,
      reason: patch.moderation_reason ?? "",
    },
    meta: { ip: "", country: "", userAgent: "", path: "" },
  });
  const failures = (patch.failure_details ?? job.failure_details ?? []) as FailureDetail[];
  const lastHint = failures.length ? failures[failures.length - 1].hint : "";
  const name = escapeHtml(job.title || "tu formulario");
  await sendServiceEmail(job.user_id, patch.status === "done" ? "job_done" : "job_failed", {
    subject:
      patch.status === "done"
        ? `Listo: ${sent} respuestas llegaron a ${job.title || "tu formulario"}`
        : `Tu envío no se completó: ${job.title || "tu formulario"}`,
    title: patch.status === "done" ? `Llegaron ${sent} de ${job.total} respuestas` : "Tu envío no se completó",
    bodyHtml:
      patch.status === "done"
        ? `<p>Terminamos el envío de prueba a <strong>${name}</strong>: llegaron ${sent} de ${job.total} respuestas${failed > 0 ? ` y Google rechazó ${failed}` : ""}.</p>` +
          `<p>Ya puedes revisar el resumen de respuestas en tu Google Form.</p>` +
          (back > 0 ? `<p>Te devolvimos <strong>${back} ${job.is_paid ? "créditos" : "respuestas gratis"}</strong> por las que no llegaron.</p>` : "")
        : `<p>No pudimos completar el envío a <strong>${name}</strong> (llegaron ${sent} de ${job.total}).</p>` +
          (lastHint ? `<p><strong>Cómo arreglarlo:</strong> ${escapeHtml(lastHint)}</p>` : "") +
          (back > 0 ? `<p>Te devolvimos <strong>${back} ${job.is_paid ? "créditos" : "respuestas gratis"}</strong>: no perdiste nada.</p>` : ""),
    cta: { label: patch.status === "done" ? "Probar otro formulario" : "Ver qué falló y reintentar", url: `${siteUrl()}/` },
  });
  await notifyUser(job.user_id, {
    kind: patch.status === "done" ? "job_done" : "job_failed",
    title:
      patch.status === "done"
        ? `Envío terminado: ${sent} de ${job.total} respuestas`
        : `Tu envío no se completó (${sent} de ${job.total})`,
    body: `${job.title || "Tu formulario"}.${failed > 0 ? ` ${failed} rechazadas por Google.` : ""}${back > 0 ? ` Te devolvimos ${back} ${job.is_paid ? "créditos" : "respuestas gratis"}.` : ""}`,
    link: "/",
  });
}

/**
 * Corre `fn` con concurrencia limitada y deja de EMPEZAR ítems nuevos al
 * pasar `deadline`. Lo devuelto es siempre un prefijo contiguo del lote.
 */
async function runPool<T, R>(items: T[], limit: number, deadline: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length && Date.now() < deadline) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out.slice(0, next);
}

export function statusPayload(job: WebJob, extra: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: job.status,
    sent: job.sent,
    failed: job.failed,
    total: job.total,
    generated: (job.profiles ?? []).length,
    queuePosition: 0,
    failures: (job.failure_details ?? []).slice(-5),
    failCode: job.fail_code ?? null,
    isPaid: job.is_paid,
    ...extra,
  };
}

/** Avanza un paso el envío. Seguro de llamar desde varios lugares a la vez. */
export async function advanceJob(job: WebJob): Promise<AdvanceResult> {
  const supa = db();
  const ok = (body: Record<string, unknown>): AdvanceResult => ({ httpStatus: 200, body });

  // Un solo tick a la vez por job: con dos pestañas, dos máquinas o el
  // worker a la vez, dos ticks tomaban el mismo lote y mandaban respuestas
  // DUPLICADAS a Google.
  let lockRelease: { tick_lock_until?: null; progress_at?: string } = {};
  let progressSupported = false;
  if (job.status === "processing") {
    const now = new Date();
    const { data: locked, error: lockErr } = await supa
      .from("web_jobs")
      .update({ tick_lock_until: new Date(now.getTime() + LOCK_MS).toISOString() })
      .eq("id", job.id)
      .or(`tick_lock_until.is.null,tick_lock_until.lt.${now.toISOString()}`)
      .select("id");
    // Si la columna aún no existe (schema sin re-ejecutar), se sigue sin lock.
    if (!lockErr && !locked?.length) return ok(statusPayload(job, { phase: "busy" }));
    if (!lockErr) {
      lockRelease = { tick_lock_until: null };
      progressSupported = "progress_at" in job;
    }
  }

  if (job.status === "queued") {
    const claimed = await claimSlot(job);
    const queuePosition = await getQueuePosition(claimed);
    return ok(statusPayload(claimed, { queuePosition }));
  }

  if (job.status !== "processing") {
    return ok(statusPayload(job, { reason: job.moderation_reason || undefined }));
  }

  const lastProgress = Date.parse(job.progress_at || job.started_at || job.created_at);
  const stuckAfter = job.progress_at ? STUCK_WITHOUT_PROGRESS_MS : STUCK_FALLBACK_MS;
  if (Date.now() - lastProgress > stuckAfter) {
    const back = refundAmount(job, job.sent);
    const reason =
      back > 0
        ? `El envío se detuvo después de ${job.sent} respuesta(s). Te devolvimos ${back} ${job.is_paid ? "créditos" : "respuestas gratis"}.`
        : `El envío se detuvo después de ${job.sent} respuesta(s).`;
    await finishJob(job, { status: job.sent > 0 ? "done" : "failed", moderation_reason: reason });
    return ok(statusPayload({ ...job, status: job.sent > 0 ? "done" : "failed" }, { reason, refunded: back }));
  }

  if (progressSupported) lockRelease.progress_at = new Date().toISOString();

  const tickStart = Date.now();
  const form = jobToForm(job);
  const aiInvolved = job.is_paid && needsAi(form.questions, job.q_config);

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
        // Defensa en profundidad: un envío gratis nunca usa Groq.
        qConfig: job.is_paid
          ? job.q_config
          : Object.fromEntries(
              Object.entries(job.q_config ?? {}).map(([k, v]) => [k, v?.mode === "ai" ? { ...v, mode: "random" as const } : v])
            ),
        language: job.language,
        customInstructions: job.custom_instructions,
        startIndex: generatedSoFar.length,
      });
    } catch (e) {
      const reason = e instanceof Error ? e.message : "Fallo generando respuestas";
      console.error(`[job] generateProfiles falló para job ${job.id}:`, reason);
      const friendly = /429|rate limit|tokens per/i.test(reason)
        ? "La IA está saturada en este momento. Se te devolvieron los créditos: intenta de nuevo en unos minutos o usa Aleatorio/Fijo."
        : "No se pudieron generar las respuestas con IA. Se te devolvieron los créditos; intenta de nuevo.";
      await finishJob(job, { status: "failed", moderation_reason: friendly });
      return { httpStatus: 502, body: { ok: false, status: "failed", error: friendly, reason: friendly } };
    }
    const profiles = [...generatedSoFar, ...chunk].slice(0, job.total);
    await supa.from("web_jobs").update({ profiles, ...lockRelease }).eq("id", job.id);
    return ok(statusPayload({ ...job, profiles }, { phase: "generating", generated: profiles.length }));
  }

  // ── Fase 2: enviar a Google ────────────────────────────────────────
  const alreadyDone = job.sent + job.failed;
  const batch = generatedSoFar.slice(alreadyDone, alreadyDone + SUBMIT_BATCH);

  const results: SubmitResult[] = await runPool(batch, SUBMIT_CONCURRENCY, tickStart + SUBMIT_BUDGET_MS, (profile) =>
    submitOne(form, profile)
  );

  // Google pidió el correo del encuestado y el formulario no lo mostraba al
  // leerlo: se marca y el mismo lote se reintenta con correo en el próximo
  // tick (no cuenta como rechazo).
  if (!job.collects_email && results.some((r) => r.needsEmail) && (await hasColumn("web_jobs", "collects_email"))) {
    await supa
      .from("web_jobs")
      .update({ collects_email: true, ...lockRelease })
      .eq("id", job.id)
      .eq("status", "processing");
    return ok(statusPayload(job, { phase: "sending" }));
  }

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
      code: failureCode(form, r),
    });
  });
  const failureDetails = failures.slice(-MAX_FAILURE_DETAILS);
  const failFast = sent === 0 && failed >= FAIL_FAST_AFTER;

  if (sent + failed >= job.total || failFast) {
    const status = sent === 0 ? "failed" : "done";
    const code = mainFailCode(failureDetails);
    const lastHint = failureDetails.length ? failureDetails[failureDetails.length - 1].hint : "";
    const reason =
      sent === 0 && failureDetails.length
        ? `${failFast && failed < job.total ? `Detuvimos el envío: las primeras ${failed} respuestas fueron rechazadas por Google. ` : "Google rechazó todas las respuestas. "}${lastHint}`
        : undefined;
    await finishJob(job, {
      status,
      sent,
      failed,
      failure_details: failureDetails,
      ...(status === "failed" && code ? { fail_code: code } : {}),
      ...(reason ? { moderation_reason: reason } : {}),
    });
    return ok(
      statusPayload(
        { ...job, status, sent, failed, failure_details: failureDetails, fail_code: status === "failed" ? code : null },
        { reason, refunded: refundAmount(job, sent) }
      )
    );
  }

  await supa
    .from("web_jobs")
    .update({ sent, failed, failure_details: failureDetails, ...lockRelease })
    .eq("id", job.id)
    .eq("status", "processing");
  return ok(statusPayload({ ...job, sent, failed, failure_details: failureDetails }, { phase: "sending" }));
}
