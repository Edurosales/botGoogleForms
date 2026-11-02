import { NextResponse } from "next/server";
import { getWebUser } from "@/lib/googleAuth";
import { db, type WebJob } from "@/lib/db";
import { cancelJob, statusPayload } from "@/lib/jobRunner";
import { rateLimit } from "@/lib/ratelimit";

/** POST → el dueño del envío lo cancela. No se envía nada más y se devuelve lo no enviado. */
export async function POST(_req: Request, ctx: RouteContext<"/api/web/jobs/[id]/cancel">) {
  const user = await getWebUser();
  if (!user) return NextResponse.json({ ok: false, reason: "Inicia sesión." }, { status: 401 });
  if (!rateLimit(`web-cancel:${user.id}`, 10, 10 * 60_000)) {
    return NextResponse.json({ ok: false, reason: "Demasiados intentos. Espera unos minutos." }, { status: 429 });
  }
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, reason: "No encontrado." }, { status: 404 });

  const { data: job } = await db().from("web_jobs").select("*").eq("id", id).maybeSingle<WebJob>();
  if (!job || job.user_id !== user.id) return NextResponse.json({ ok: false, reason: "No encontrado." }, { status: 404 });

  const r = await cancelJob(job);
  if (!r.ok) return NextResponse.json({ ok: false, reason: "Ese envío ya terminó." }, { status: 409 });
  return NextResponse.json(statusPayload({ ...job, status: "failed", sent: r.sent }, { reason: "Cancelaste el envío.", refunded: r.refunded, cancelled: true }));
}
