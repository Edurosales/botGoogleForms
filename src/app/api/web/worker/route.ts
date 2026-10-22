import { NextResponse, after } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { db, type WebJob } from "@/lib/db";
import { advanceJob, type AdvanceResult } from "@/lib/jobRunner";
import { siteUrl } from "@/lib/config";
import { sendNewsletterBatch } from "@/lib/mailer";
import { hasColumn } from "@/lib/schemaFlags";
import { sweepAbsent } from "@/lib/queue";

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
  // trim: al pegar el secreto en Vercel o en el SQL de Supabase es común que
  // se cuele un espacio o salto de línea, y la comparación exacta daba 401.
  const secret = (process.env.WORKER_SECRET || "").trim();
  if (secret.length < 16) {
    console.error("[worker] WORKER_SECRET no está configurado (o es muy corto) en este deploy");
    return false;
  }
  const got = (req.headers.get("authorization") || "").trim().replace(/^Bearer\s+/i, "").trim();
  const a = Buffer.from(got);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function activeJobs(limit: number): Promise<WebJob[]> {
  // Los que ya están enviando primero ("processing" < "queued"), luego pagados,
  // luego la prioridad que puso el admin y por último el más antiguo.
  let q = db()
    .from("web_jobs")
    .select("*")
    .in("status", ["queued", "processing"])
    .order("status", { ascending: true })
    .order("is_paid", { ascending: false });
  if (await hasColumn("web_jobs", "priority")) q = q.order("priority", { ascending: false });
  const turnCol = (await hasColumn("web_jobs", "queue_at")) ? "queue_at" : "created_at";
  const { data } = await q.order(turnCol, { ascending: true }).limit(limit);
  return (data ?? []) as WebJob[];
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false }, { status: 401 });

  const start = Date.now();
  // Gratis que cerraron la ventana: al final de la fila (o cancelados tras 10 min).
  const swept = await sweepAbsent().catch(() => null);
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

  // Boletín: unos pocos correos por pasada con el tiempo que sobre.
  const leftMs = RUN_BUDGET_MS - (Date.now() - start);
  const newsletter = leftMs > 8_000 ? await sendNewsletterBatch(15, Date.now() + Math.min(20_000, leftMs - 5_000)).catch(() => null) : null;

  const remaining = (await activeJobs(1)).length > 0;
  if (remaining) {
    // Re-encadenar sin esperar: el cron de cada minuto es solo la red de seguridad.
    after(async () => {
      await fetch(`${siteUrl()}/api/web/worker`, {
        method: "POST",
        headers: { Authorization: `Bearer ${(process.env.WORKER_SECRET || "").trim()}` },
        signal: AbortSignal.timeout(3_000),
        cache: "no-store",
      }).catch(() => {});
    });
  }

  return NextResponse.json({ ok: true, advanced, remaining, newsletter, swept, ms: Date.now() - start });
}
