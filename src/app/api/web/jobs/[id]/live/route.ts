import { getWebUser } from "@/lib/googleAuth";
import { db, type WebJob } from "@/lib/db";
import { advanceJob } from "@/lib/jobRunner";
import { touchPresence } from "@/lib/queue";

// Vercel no admite WebSockets: la fila en vivo usa Server-Sent Events. La
// conexión dura ~50 s y el navegador (EventSource) se reconecta solo.
export const maxDuration = 60;

const STREAM_MS = 50_000;
const EVERY_MS = 2_000;

/**
 * GET /api/web/jobs/:id/live → eventos "state" cada 2 s mientras el envío
 * está en fila: posición, pausa, turnos perdidos. Mantener esta conexión
 * abierta ES estar presente (la fila gratis exige la ventana abierta).
 * Cuando el envío sale de la fila manda el estado final y cierra.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getWebUser();
  if (!user) return new Response("No autorizado", { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("No encontrado", { status: 404 });

  const first = await db().from("web_jobs").select("*").eq("id", id).maybeSingle<WebJob>();
  if (!first.data || first.data.user_id !== user.id) return new Response("No encontrado", { status: 404 });

  const encoder = new TextEncoder();
  const started = Date.now();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      // Reintento sugerido al navegador cuando la conexión se corta.
      controller.enqueue(encoder.encode("retry: 1500\n\n"));
      let closed = false;
      req.signal.addEventListener("abort", () => {
        closed = true;
      });
      try {
        while (!closed && Date.now() - started < STREAM_MS) {
          const { data: job } = await db().from("web_jobs").select("*").eq("id", id).maybeSingle<WebJob>();
          if (!job) break;
          if (job.status === "queued" && !job.is_paid) await touchPresence(job.id);
          // advanceJob en fila solo intenta tomar el turno (no envía nada aquí).
          const res = job.status === "queued" ? await advanceJob(job) : null;
          const body = res?.body ?? { ok: true, status: job.status, sent: job.sent, failed: job.failed, total: job.total };
          send("state", { ...body, isPaid: job.is_paid, title: job.title });
          if (body.status !== "queued") break;
          await new Promise((r) => setTimeout(r, EVERY_MS));
        }
      } catch {
        send("error", { ok: false });
      } finally {
        if (!closed) controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
