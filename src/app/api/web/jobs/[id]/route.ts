import { NextResponse } from "next/server";
import { getWebUser } from "@/lib/googleAuth";
import { db, type WebJob } from "@/lib/db";
import { getQueuePosition } from "@/lib/queue";

/** Lectura liviana del estado (no avanza el envío): la usa el botón "Actualizar". */
export async function GET(_req: Request, ctx: RouteContext<"/api/web/jobs/[id]">) {
  const user = await getWebUser();
  if (!user) return NextResponse.json({ ok: false, error: "No autorizado." }, { status: 401 });

  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "No encontrado." }, { status: 404 });

  const { data: job } = await db().from("web_jobs").select("*").eq("id", id).maybeSingle<WebJob>();
  if (!job || job.user_id !== user.id) {
    return NextResponse.json({ ok: false, error: "No encontrado." }, { status: 404 });
  }

  const queuePosition = job.status === "queued" ? await getQueuePosition(job) : 0;
  return NextResponse.json({
    ok: true,
    status: job.status,
    sent: job.sent,
    failed: job.failed,
    total: job.total,
    queuePosition,
    isPaid: job.is_paid,
    title: job.title,
    failures: (job.failure_details ?? []).slice(-5),
    reason: job.moderation_reason || undefined,
  });
}
