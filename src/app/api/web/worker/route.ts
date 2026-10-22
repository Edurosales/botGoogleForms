import { NextResponse, after } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { db, type WebJob } from "@/lib/db";
import { advanceJob, type AdvanceResult } from "@/lib/jobRunner";
import { siteUrl } from "@/lib/config";

/**
 * Worker en la nube: avanza TODOS los envíos activos sin depender del
 * navegador del cliente (si cierra la pestaña, el envío sigue). Lo dispara
 * Supabase cada minuto (pg_cron + pg_net, ver supabase/worker_cron.sql) y se
 * re-encadena solo mientras quede trabajo. Varias ejecuciones a la vez son
 * seguras: cada envío tiene su propio bloqueo (tick_lock_until).
 */
export const maxDuration = 60;

const RUN_BUDGET_MS = 40_000;
const PARALLEL_JOBS = 3;

function authorized(req: Request): boolean {
  const secret = process.env.WORKER_SECRET || "";
  if (secret.length < 16) return false;
  const got = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(got);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function activeJobs(limit: number): Promise<WebJob[]> {
  const { data } = await db()
    .from("web_jobs")
    .select("*")
    .in("status", ["queued", "processing"])
    .order("is_paid", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(limit);
  return (data ?? []) as WebJob[];
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false }, { status: 401 });

  const start = Date.now();
  let advanced = 0;
  while (Date.now() - start < RUN_BUDGET_MS) {
    const jobs = await activeJobs(PARALLEL_JOBS * 2);
    if (!jobs.length) break;
    // Cada paso de envío dura hasta ~30 s: solo se arranca otra ronda si cabe.
    const round = jobs.slice(0, PARALLEL_JOBS);
    const results = await Promise.all(
      round.map((j) =>
        advanceJob(j).catch((e): AdvanceResult => ({ httpStatus: 500, body: { error: String(e) } }))
      )
    );
    advanced += results.length;
    // Si todos estaban ocupados por otro proceso, no insistir en bucle.
    if (results.every((r) => r.body.phase === "busy")) break;
    if (Date.now() - start > RUN_BUDGET_MS - 25_000) break;
  }

  const remaining = (await activeJobs(1)).length > 0;
  if (remaining) {
    // Re-encadenar sin esperar: el cron de cada minuto es solo la red de seguridad.
    after(async () => {
      await fetch(`${siteUrl()}/api/web/worker`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.WORKER_SECRET}` },
        signal: AbortSignal.timeout(3_000),
        cache: "no-store",
      }).catch(() => {});
    });
  }

  return NextResponse.json({ ok: true, advanced, remaining, ms: Date.now() - start });
}
