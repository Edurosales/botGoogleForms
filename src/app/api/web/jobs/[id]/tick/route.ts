import { NextResponse } from "next/server";
import { getWebUser } from "@/lib/googleAuth";
import { db, type WebJob } from "@/lib/db";
import { claimSlot, getQueuePosition } from "@/lib/queue";
import { generateProfiles } from "@/lib/aiProfiles";
import { submitOne } from "@/lib/formSubmitter";
import type { ParsedForm, ParsedQuestion } from "@/lib/formParser";

const BATCH_SIZE = 4; // respuestas enviadas por cada llamada a /tick

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
    return NextResponse.json({ ok: true, status: job.status, sent: job.sent, failed: job.failed, total: job.total, queuePosition: 0 });
  }

  const form = jobToForm(job);

  let profiles = job.profiles;
  if (!profiles) {
    try {
      profiles = await generateProfiles(form, {
        nProfiles: job.total,
        qConfig: job.q_config,
        language: job.language,
        customInstructions: job.custom_instructions,
      });
    } catch (e) {
      await supa
        .from("web_jobs")
        .update({ status: "failed", moderation_reason: e instanceof Error ? e.message : "Fallo generando respuestas", finished_at: new Date().toISOString() })
        .eq("id", job.id);
      return NextResponse.json({ ok: false, error: "No se pudieron generar las respuestas." }, { status: 502 });
    }
    await supa.from("web_jobs").update({ profiles }).eq("id", job.id);
  }

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
