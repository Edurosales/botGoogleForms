import { NextResponse } from "next/server";
import { getWebUser } from "@/lib/googleAuth";
import { db, type WebJob } from "@/lib/db";
import { getQueuePosition } from "@/lib/queue";

export async function GET(_req: Request, ctx: RouteContext<"/api/web/jobs/[id]">) {
  const user = await getWebUser();
  if (!user) return NextResponse.json({ ok: false, error: "No autorizado." }, { status: 401 });

  const { id } = await ctx.params;
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
    moderationReason: job.moderation_reason,
  });
}
