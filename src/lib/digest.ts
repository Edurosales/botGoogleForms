/**
 * Resumen diario por correo al dueño: lo que pasó AYER (hora de Lima). Sale
 * una vez al día desde las 8 a. m.; el worker lo intenta en cada pasada y se
 * recuerda en web_audit_log (owner.daily_digest con la fecha) para no repetir.
 */
import { db } from "./db";
import { audit } from "./audit";
import { mailOwner } from "./alerts";
import { escapeHtml, summaryTable } from "./mailer";

const NO_REQ = { ip: "", country: "", userAgent: "", path: "" };
const TZ = "America/Lima";
const pen = (c: number) => `S/ ${(c / 100).toFixed(2)}`;

/** Fecha (YYYY-MM-DD) y hora en Lima. */
function limaNow(d = new Date()): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

export async function ownerDailyDigest(): Promise<{ sent: boolean } | null> {
  const { date, hour } = limaNow();
  if (hour < 8) return null;
  const supa = db();
  const { data: done, error } = await supa.from("web_audit_log").select("id").eq("action", "owner.daily_digest").eq("target", date).limit(1);
  if (error || done?.length) return null;
  // Se anota ANTES de enviar: si dos workers coinciden, a lo sumo se duplica uno.
  await audit({ action: "owner.daily_digest", target: date, meta: NO_REQ });

  // Ayer en Lima (UTC-5, sin horario de verano): de 05:00 UTC a 05:00 UTC.
  const todayStart = new Date(`${date}T05:00:00.000Z`);
  const from = new Date(todayStart.getTime() - 86400_000).toISOString();
  const to = todayStart.toISOString();
  const yesterday = new Date(todayStart.getTime() - 86400_000).toLocaleDateString("es-PE", { timeZone: TZ, dateStyle: "full" });

  const [paid, tried, users, jobs, unread, keys, refunds] = await Promise.all([
    supa.from("web_credit_orders").select("amount_cents,credits").eq("status", "paid").gte("paid_at", from).lt("paid_at", to).limit(5000),
    supa.from("web_credit_orders").select("status").gte("created_at", from).lt("created_at", to).limit(5000),
    supa.from("web_users").select("id", { count: "exact", head: true }).gte("created_at", from).lt("created_at", to),
    supa.from("web_jobs").select("sent,failed,status,is_paid").gte("created_at", from).lt("created_at", to).limit(5000),
    supa.from("web_messages").select("id", { count: "exact", head: true }).eq("sender", "user").is("read_at", null),
    supa.from("ai_providers").select("label,provider,status,enabled").eq("enabled", true),
    supa.from("web_credit_orders").select("amount_cents").eq("status", "refunded").gte("refunded_at", from).lt("refunded_at", to),
  ]);

  const paidRows = (paid.data ?? []) as { amount_cents: number; credits: number }[];
  const triedRows = (tried.data ?? []) as { status: string }[];
  const jobRows = (jobs.data ?? []) as { sent: number; failed: number; status: string; is_paid: boolean }[];
  const keyRows = (keys.data ?? []) as { label: string; provider: string; status: string }[];
  const refundRows = (refunds.data ?? []) as { amount_cents: number }[];
  const income = paidRows.reduce((n, o) => n + o.amount_cents, 0);
  const keysOk = keyRows.filter((k) => k.status === "ok" || k.status === "unknown").length;
  const keysBad = keyRows.filter((k) => k.status === "invalid" || k.status === "exhausted" || k.status === "failing");
  const unreadN = unread.count ?? 0;

  const todo: string[] = [];
  if (unreadN > 0) todo.push(`Responder ${unreadN} mensaje(s) sin leer (Panel → Mensajes).`);
  if (keysBad.length) todo.push(`Revisar claves de IA: ${keysBad.map((k) => `${k.label || k.provider} (${k.status})`).join(", ")}.`);
  if (!keyRows.length) todo.push("No hay claves de IA cargadas en el panel: se usan las del entorno.");

  const html =
    summaryTable([
      ["Ventas", `<strong>${escapeHtml(pen(income))}</strong> (${paidRows.length} compras, ${paidRows.reduce((n, o) => n + o.credits, 0)} créditos)`],
      ["Devoluciones", refundRows.length ? escapeHtml(`${refundRows.length} (${pen(refundRows.reduce((n, o) => n + o.amount_cents, 0))})`) : "0"],
      [
        "Intentos de pago",
        `${triedRows.length}: ${triedRows.filter((o) => o.status === "paid").length} pagados, ${triedRows.filter((o) => o.status === "failed").length} rechazados, ${triedRows.filter((o) => o.status === "pending").length} sin completar`,
      ],
      ["Cuentas nuevas", String(users.count ?? 0)],
      [
        "Envíos",
        `${jobRows.length} (${jobRows.filter((j) => j.is_paid).length} con créditos) · ${jobRows.reduce((n, j) => n + (j.sent ?? 0), 0)} respuestas llegaron, ${jobRows.reduce((n, j) => n + (j.failed ?? 0), 0)} rechazadas`,
      ],
      ["Mensajes sin leer", String(unreadN)],
      ["Claves de IA", keyRows.length ? `${keysOk} de ${keyRows.length} funcionando` : "sin claves en el panel"],
    ]) +
    (todo.length ? `<p><strong>Para hoy:</strong></p><ul>${todo.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>` : "<p>Todo en orden. ✅</p>");

  await mailOwner(`📊 FormsBot: resumen de ayer (${pen(income)})`, `Resumen del ${yesterday}`, html);
  return { sent: true };
}
