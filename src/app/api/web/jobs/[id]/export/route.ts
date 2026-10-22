import { NextResponse } from "next/server";
import { getWebUser } from "@/lib/googleAuth";
import { db, type WebJob } from "@/lib/db";
import { buildXlsx } from "@/lib/xlsx";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/ratelimit";

type Q = { entry: string; title: string };

/** ¿Cliente de pago? Créditos comprados en saldo o alguna compra pagada. */
async function isPremium(userId: string, credits: number): Promise<boolean> {
  if (credits > 0) return true;
  const { count } = await db()
    .from("web_credit_orders")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "paid");
  return (count ?? 0) > 0;
}

function table(job: WebJob): { header: string[]; rows: string[][] } {
  const questions = (job.questions as Q[]).filter((q) => q?.entry);
  const failed = new Set((job.failure_details ?? []).map((f) => f.index));
  const withEmail = (job.profiles ?? []).some((p) => p.emailAddress);
  const times = job.response_times ?? [];
  const fmt = (iso?: string) =>
    iso ? new Date(iso).toLocaleString("es-PE", { timeZone: "America/Lima", dateStyle: "short", timeStyle: "medium" }) : "";
  const header = ["#", "Estado", "Fecha y hora (Lima)", ...(withEmail ? ["Correo"] : []), ...questions.map((q) => q.title || q.entry)];
  const attempted = job.sent + job.failed;
  const rows = (job.profiles ?? []).slice(0, attempted).map((p, i) => [
    String(i + 1),
    failed.has(i + 1) ? "Rechazada" : "Enviada",
    fmt(times[i]),
    ...(withEmail ? [p.emailAddress ?? ""] : []),
    ...questions.map((q) => (p[q.entry] ?? "").replace(/\|/g, ", ")),
  ]);
  return { header, rows };
}

/**
 * GET /api/web/jobs/:id/export → .xlsx con lo enviado (solo clientes de pago).
 * GET ?preview=1 → las primeras 3 filas en JSON (cualquiera, para mostrar lo
 * que obtendría al hacerse premium).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getWebUser();
  if (!user) return NextResponse.json({ ok: false, error: "Inicia sesión." }, { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "No encontrado." }, { status: 404 });
  if (!rateLimit(`export-xlsx:${user.id}`, 20, 10 * 60_000)) {
    return NextResponse.json({ ok: false, error: "Demasiadas descargas seguidas." }, { status: 429 });
  }

  const { data: job } = await db().from("web_jobs").select("*").eq("id", id).maybeSingle<WebJob>();
  if (!job || job.user_id !== user.id) return NextResponse.json({ ok: false, error: "No encontrado." }, { status: 404 });
  if (!job.profiles?.length) {
    return NextResponse.json(
      { ok: false, code: "EXPIRED", error: "Las respuestas de este envío ya no están guardadas (se borran a los 90 días)." },
      { status: 410 }
    );
  }

  const premium = await isPremium(user.id, user.credits);
  const { header, rows } = table(job);

  if (new URL(req.url).searchParams.get("preview") === "1") {
    return NextResponse.json({ ok: true, premium, header, rows: rows.slice(0, 3), total: rows.length });
  }
  if (!premium) {
    return NextResponse.json(
      { ok: false, code: "PREMIUM_REQUIRED", error: "Exportar a Excel es para clientes con créditos comprados." },
      { status: 402 }
    );
  }

  await audit({ action: "job.export", userId: user.id, email: user.email, target: job.id, details: { rows: rows.length } });
  const file = buildXlsx("Respuestas", header, rows);
  const name = (job.title || "formulario").replace(/[^\p{L}\p{N} _-]/gu, "").trim().slice(0, 60) || "formulario";
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="formsbot-${encodeURIComponent(name)}.xlsx"; filename*=UTF-8''formsbot-${encodeURIComponent(name)}.xlsx`,
      "Cache-Control": "no-store",
    },
  });
}
