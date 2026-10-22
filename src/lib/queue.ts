/**
 * Cola con dos pools separados — gratis y pagado — así un job pagado
 * nunca espera detrás de la cola gratis llena (cupo reservado, no solo
 * prioridad de orden).
 */
import { db, type WebJob } from "./db";
import { getAppSettings } from "./appSettings";
import { hasColumn } from "./schemaFlags";

/**
 * Orden de la fila dentro de cada pool: prioridad manual (el admin puede
 * subir un envío) y luego el más antiguo. Sin la columna priority (SQL de la
 * ronda sin correr) es solo por antigüedad.
 */
async function aheadOf(job: WebJob) {
  let q = db()
    .from("web_jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "queued")
    .eq("is_paid", job.is_paid)
    .neq("id", job.id);
  if (await hasColumn("web_jobs", "priority")) {
    const p = job.priority ?? 0;
    q = q.or(`priority.gt.${p},and(priority.eq.${p},created_at.lt."${job.created_at}")`);
  } else {
    q = q.lt("created_at", job.created_at);
  }
  const { count } = await q;
  return count ?? 0;
}

const STALE_PROCESSING_MS = 15 * 60_000;

/** Si hay cupo libre en el pool del job, lo pasa de 'queued' a 'processing'. */
export async function claimSlot(job: WebJob): Promise<WebJob> {
  if (job.status !== "queued") return job;

  const settings = await getAppSettings();
  const cap = job.is_paid ? settings.paid_concurrency : settings.free_concurrency;

  // Los envíos avanzan solo mientras su dueño tiene la pestaña abierta. Si
  // alguien la cerró a la mitad, su job queda "processing" para siempre y
  // bloquearía un cupo — por eso solo cuentan los que arrancaron hace poco.
  const cutoff = new Date(Date.now() - STALE_PROCESSING_MS).toISOString();
  const { count } = await db()
    .from("web_jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "processing")
    .eq("is_paid", job.is_paid)
    .gte("started_at", cutoff);

  const free = cap - (count ?? 0);
  if (free <= 0) return job; // sin cupo todavía
  // Respeta la fila: solo entra si hay cupo para todos los que van antes.
  if ((await aheadOf(job)) >= free) return job;

  // Claim atómico: solo gana si sigue en 'queued' (evita doble-arranque por polls concurrentes).
  const { data } = await db()
    .from("web_jobs")
    .update({ status: "processing", started_at: new Date().toISOString() })
    .eq("id", job.id)
    .eq("status", "queued")
    .select()
    .maybeSingle<WebJob>();

  return data ?? job;
}

/** Posición en la cola (1 = siguiente) dentro del mismo pool (gratis/pagado). */
export async function getQueuePosition(job: WebJob): Promise<number> {
  if (job.status !== "queued") return 0;
  return (await aheadOf(job)) + 1;
}
