import { NextResponse } from "next/server";
import { getWebUser } from "@/lib/googleAuth";
import { db, type WebJob } from "@/lib/db";
import { advanceJob } from "@/lib/jobRunner";
import { touchPresence } from "@/lib/queue";

// Ver lib/jobRunner.ts: generar y enviar nunca van en la misma invocación.
export const maxDuration = 60;

/** Avance empujado por el navegador. El worker (/api/web/worker) hace lo mismo sin navegador. */
export async function POST(_req: Request, ctx: RouteContext<"/api/web/jobs/[id]/tick">) {
  const user = await getWebUser();
  if (!user) return NextResponse.json({ ok: false, error: "No autorizado." }, { status: 401 });

  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "No encontrado." }, { status: 404 });

  const { data: job } = await db().from("web_jobs").select("*").eq("id", id).maybeSingle<WebJob>();
  if (!job || job.user_id !== user.id) {
    return NextResponse.json({ ok: false, error: "No encontrado." }, { status: 404 });
  }

  // La ventana del cliente está abierta: conserva su turno en la fila gratis.
  if (job.status === "queued" && !job.is_paid) await touchPresence(job.id);
  const res = await advanceJob(job);
  return NextResponse.json(res.body, { status: res.httpStatus });
}
