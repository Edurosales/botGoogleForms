import { NextResponse } from "next/server";
import { getWebUser } from "@/lib/googleAuth";
import { db, type WebJob } from "@/lib/db";
import { claimSlot, getQueuePosition } from "@/lib/queue";
import { generateProfiles } from "@/lib/aiProfiles";
import { submitOne } from "@/lib/formSubmitter";
import type { ParsedForm, ParsedQuestion } from "@/lib/formParser";

// Vercel mata la función a los ~10s por defecto (plan Hobby). Generar
// perfiles (llamada a un modelo de razonamiento) ya puede tardar varios
// segundos, y cada envío a Google suma GET + espera 0.4–1.8s + POST —
// con BATCH_SIZE=4 esto se pasaba del límite y la función moría a mitad
// de camino (502), perdiendo el trabajo sin dejar rastro. Ahora:
// 1) un tick que genera perfiles NO envía nada ese mismo tick (se separa
//    el trabajo pesado en dos invocaciones distintas), y
// 2) el lote de envío por tick se redujo a 2.
export const maxDuration = 60;
const BATCH_SIZE = 2; // respuestas enviadas por cada llamada a /tick
// Groq cobra por "tokens por minuto" (TPM) sobre prompt + max_tokens
// RESERVADOS, no sobre lo que realmente se usa — pedir las 30 de una
// sola llamada reservaba ~9700 tokens contra un límite de 8000 y Groq
// rechazaba la solicitud entera (413) antes de generar nada. Generar en
// lotes chicos mantiene cada llamada bien debajo del límite.
const GEN_CHUNK = 6; // perfiles generados por cada llamada a Groq

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

export async function POST(_req: Request, ctx: RouteContext<"/api/web/jobs/[id]/tick">) {
  const user = await getWebUser();
  if (!user) return NextResponse.json({ ok: false, error: "No autorizado." }, { status: 401 });

  const { id } = await ctx.params;
  const supa = db();
  const { data: job } = await supa.from("web_jobs").select("*").eq("id", id).maybeSingle<WebJob>();
  if (!job || job.user_id !== user.id) {
    return NextResponse.json({ ok: false, error: "No encontrado." }, { status: 404 });
  }

  if (job.status === "queued") {
    const claimed = await claimSlot(job);
    const queuePosition = await getQueuePosition(claimed);
    return NextResponse.json({ ok: true, status: claimed.status, queuePosition, sent: claimed.sent, failed: claimed.failed, total: claimed.total });
  }

  if (job.status !== "processing") {
    return NextResponse.json({
      ok: true,
      status: job.status,
      sent: job.sent,
      failed: job.failed,
      total: job.total,
      queuePosition: 0,
      reason: job.moderation_reason || undefined,
    });
  }

  const form = jobToForm(job);

  const generatedSoFar = job.profiles ?? [];
  if (generatedSoFar.length < job.total) {
    const remaining = job.total - generatedSoFar.length;
    const chunkSize = Math.min(GEN_CHUNK, remaining);
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
      await supa
        .from("web_jobs")
        .update({ status: "failed", moderation_reason: reason, finished_at: new Date().toISOString() })
        .eq("id", job.id);
      return NextResponse.json({ ok: false, error: "No se pudieron generar las respuestas.", reason }, { status: 502 });
    }
    const profiles = [...generatedSoFar, ...chunk];
    await supa.from("web_jobs").update({ profiles }).eq("id", job.id);
    // Este tick solo generó un lote: el envío empieza una vez estén
    // los `job.total` perfiles completos, para no acumular la llamada a
    // la IA + envíos en una sola invocación.
    return NextResponse.json({ ok: true, status: "processing", sent: job.sent, failed: job.failed, total: job.total, queuePosition: 0 });
  }

  const profiles = generatedSoFar;
  const alreadyDone = job.sent + job.failed;
  const batch = profiles.slice(alreadyDone, alreadyDone + BATCH_SIZE);

  let sent = job.sent;
  let failed = job.failed;
  for (const profile of batch) {
    const result = await submitOne(form, profile);
    if (result.ok) sent++;
    else failed++;
  }

  const finished = sent + failed >= job.total;
  const update: Partial<WebJob> & { finished_at?: string } = { sent, failed };
  if (finished) {
    update.status = failed >= job.total ? "failed" : "done";
    update.finished_at = new Date().toISOString();
  }
  await supa.from("web_jobs").update(update).eq("id", job.id);

  return NextResponse.json({ ok: true, status: finished ? update.status : "processing", sent, failed, total: job.total, queuePosition: 0 });
}
