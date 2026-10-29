/**
 * Cola con dos pools separados — gratis y pagado — así un job pagado
 * nunca espera detrás de la cola gratis llena (cupo reservado, no solo
 * prioridad de orden).
 *
 * Reglas (Ronda 17):
 * - Orden dentro de cada pool: prioridad del admin y luego `queue_at`.
 * - Pausa: `service_paused` detiene todo; la fila gratis se pausa a mano
 *   (`free_paused`) o sola cuando hay `auto_pause_free_at` pagados activos.
 * - Gratis debe tener su ventana abierta: si no se le ve en
 *   `presence_grace_seconds`, no entra y pasa al final (pierde el turno);
 *   tras ABSENT_CANCEL_MS fuera, el envío se cancela y se devuelven sus
 *   respuestas gratis. A los pagados no les aplica: siguen en la nube.
 */
import { db, type AppSettings, type WebJob } from "./db";
import { getAppSettings } from "./appSettings";
import { hasColumn } from "./schemaFlags";
import { spendCredits } from "./credits";
import { notifyUser } from "./notify";
import { audit } from "./audit";

const STALE_PROCESSING_MS = 15 * 60_000;
const ABSENT_CANCEL_MS = 10 * 60_000;
const NO_REQ = { ip: "", country: "", userAgent: "", path: "" };

export type PauseState = { all: boolean; free: boolean; auto: boolean; message: string };

export async function pauseState(settings?: AppSettings): Promise<PauseState> {
  const s = settings ?? (await getAppSettings());
  const message = (s.pause_message ?? "").trim();
  if (s.service_paused) return { all: true, free: true, auto: false, message };
  if (s.free_paused) return { all: false, free: true, auto: false, message };
  const threshold = s.auto_pause_free_at ?? 0;
  if (threshold > 0) {
    const { count } = await db()
      .from("web_jobs")
      .select("id", { count: "exact", head: true })
      .eq("is_paid", true)
      .in("status", ["queued", "processing"]);
    if ((count ?? 0) >= threshold) return { all: false, free: true, auto: true, message };
  }
  return { all: false, free: false, auto: false, message };
}

function graceMs(settings: AppSettings): number {
  return Math.min(600, Math.max(20, settings.presence_grace_seconds ?? 45)) * 1000;
}

/** Envíos gratis en fila con la ventana abierta (o todos, si no hay columna). */
async function presenceFilter(): Promise<boolean> {
  return hasColumn("web_jobs", "last_seen_at");
}

/** Cuántos van antes que este en su fila (respetando prioridad, turno y presencia). */
async function aheadOf(job: WebJob, settings: AppSettings): Promise<number> {
  let q = db()
    .from("web_jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "queued")
    .eq("is_paid", job.is_paid)
    .neq("id", job.id);
  const orderCol = (await hasColumn("web_jobs", "queue_at")) ? "queue_at" : "created_at";
  const mine = (orderCol === "queue_at" ? job.queue_at : null) ?? job.created_at;
  if (await hasColumn("web_jobs", "priority")) {
    const p = job.priority ?? 0;
    q = q.or(`priority.gt.${p},and(priority.eq.${p},${orderCol}.lt."${mine}")`);
  } else {
    q = q.lt(orderCol, mine);
  }
  // En la fila gratis solo cuentan los que siguen con su ventana abierta.
  if (!job.is_paid && (await presenceFilter())) {
    q = q.gte("last_seen_at", new Date(Date.now() - graceMs(settings)).toISOString());
  }
  const { count } = await q;
  return count ?? 0;
}

/** Si hay cupo libre en el pool del job, lo pasa de 'queued' a 'processing'. */
export async function claimSlot(job: WebJob): Promise<WebJob> {
  if (job.status !== "queued") return job;

  const settings = await getAppSettings();
  const pause = await pauseState(settings);
  if (pause.all || (!job.is_paid && pause.free)) return job;
  // Gratis sin la ventana abierta no toma su turno.
  if (!job.is_paid && (await presenceFilter()) && job.last_seen_at) {
    if (Date.now() - Date.parse(job.last_seen_at) > graceMs(settings)) return job;
  }
  const cap = job.is_paid ? settings.paid_concurrency : settings.free_concurrency;

  const cutoff = new Date(Date.now() - STALE_PROCESSING_MS).toISOString();
  let busy = db()
    .from("web_jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "processing")
    .eq("is_paid", job.is_paid)
    .gte("started_at", cutoff);
  // Los envíos repartidos en horas no ocupan cupo: casi siempre están esperando.
  if (await hasColumn("web_jobs", "spread_minutes")) busy = busy.eq("spread_minutes", 0);
  const { count } = await busy;

  const free = cap - (count ?? 0);
  if (free <= 0) return job; // sin cupo todavía
  // Respeta la fila: solo entra si hay cupo para todos los que van antes.
  if ((await aheadOf(job, settings)) >= free) return job;

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
  return (await aheadOf(job, await getAppSettings())) + 1;
}

/** La ventana del usuario sigue abierta: mantiene su turno en la fila gratis. */
export async function touchPresence(jobId: string): Promise<void> {
  if (!(await presenceFilter())) return;
  await db().from("web_jobs").update({ last_seen_at: new Date().toISOString() }).eq("id", jobId).eq("status", "queued");
}

/**
 * Lo corre el worker cada minuto: los gratis que cerraron la ventana pasan al
 * final de la fila (una vez por ausencia) y, si no vuelven en 10 minutos, su
 * envío se cancela y se les devuelven las respuestas gratis.
 */
export async function sweepAbsent(): Promise<{ moved: number; cancelled: number }> {
  const out = { moved: 0, cancelled: 0 };
  if (!(await presenceFilter()) || !(await hasColumn("web_jobs", "queue_at"))) return out;
  const settings = await getAppSettings();
  const supa = db();
  const absentSince = new Date(Date.now() - graceMs(settings)).toISOString();

  const { data: absent } = await supa
    .from("web_jobs")
    .select("id,user_id,title,queue_at,last_seen_at,lost_turns,free_credits_spent")
    .eq("status", "queued")
    .eq("is_paid", false)
    .lt("last_seen_at", absentSince)
    .limit(200);

  for (const j of (absent ?? []) as WebJob[]) {
    const lastSeen = Date.parse(j.last_seen_at ?? j.created_at);
    if (Date.now() - lastSeen > ABSENT_CANCEL_MS) {
      const { data: won } = await supa
        .from("web_jobs")
        .update({
          status: "failed",
          fail_code: "LOST_TURN",
          moderation_reason: "Saliste de la ventana mientras esperabas en la fila y perdiste tu turno. Te devolvimos tus respuestas gratis.",
          finished_at: new Date().toISOString(),
        })
        .eq("id", j.id)
        .eq("status", "queued")
        .select("id")
        .maybeSingle();
      if (!won) continue;
      if (j.free_credits_spent > 0) await spendCredits(j.user_id, 0, -j.free_credits_spent).catch(() => null);
      await notifyUser(j.user_id, {
        kind: "job_failed",
        title: "Perdiste tu turno en la fila",
        body: `${j.title || "Tu formulario"}: saliste de la ventana. Te devolvimos tus respuestas gratis; vuelve a enviarlo cuando quieras.`,
        link: "/",
      });
      await audit({ action: "queue.lost_turn_cancel", level: "info", userId: j.user_id, target: j.id, meta: NO_REQ });
      out.cancelled++;
      continue;
    }
    // Una sola vez por ausencia: si ya pasó al final después de su última visita, no se repite.
    if (j.queue_at && Date.parse(j.queue_at) > lastSeen) continue;
    const { data: moved } = await supa
      .from("web_jobs")
      .update({ queue_at: new Date().toISOString(), lost_turns: (j.lost_turns ?? 0) + 1 })
      .eq("id", j.id)
      .eq("status", "queued")
      .select("id")
      .maybeSingle();
    if (moved) out.moved++;
  }
  return out;
}
