/**
 * Envíos de un formulario. Con la columna form_id (ronda_32.sql) se busca por
 * índice; sin ella, con LIKE sobre view_url como antes.
 */
import { db } from "./db";
import { hasColumn } from "./schemaFlags";

function likePattern(formId: string): string {
  // "_" y "%" son comodines en LIKE: el ID puede traer "_".
  return `%${formId.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Cuántas cuentas distintas (sin contar `exceptUser`) ya llenaron gratis este formulario. */
export async function freeAccountsOnForm(formId: string, exceptUser?: string | null): Promise<number> {
  const byId = await hasColumn("web_jobs", "form_id");
  let q = db().from("web_jobs").select("user_id,status,sent").eq("is_paid", false);
  q = byId ? q.eq("form_id", formId) : q.like("view_url", likePattern(formId));
  if (exceptUser) q = q.neq("user_id", exceptUser);
  const { data } = await q.limit(200);
  return new Set(
    (data ?? [])
      .filter((j) => j.status === "queued" || j.status === "processing" || (j.sent ?? 0) > 0)
      .map((j) => j.user_id as string)
  ).size;
}

/** Último envío de esta cuenta a este formulario (para reaplicar su configuración). */
export async function lastJobOnForm(formId: string, userId: string) {
  const byId = await hasColumn("web_jobs", "form_id");
  let q = db().from("web_jobs").select("q_config,total,language,custom_instructions,created_at").eq("user_id", userId);
  q = byId ? q.eq("form_id", formId) : q.like("view_url", likePattern(formId));
  const { data } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data as { q_config: unknown; total: number; language: string; custom_instructions: string | null; created_at: string } | null;
}
