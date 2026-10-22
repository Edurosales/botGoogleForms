/**
 * Registro de auditoría de todo el sistema (admin → Registros): quién hizo
 * qué, cuándo, desde qué IP/país/navegador. Nunca rompe la acción que lo
 * llama: si la tabla no existe o falla, solo se escribe en la consola.
 * Se conserva 180 días (cron en ronda_16.sql).
 */
import { db } from "./db";
import { requestMeta, type RequestMeta } from "./requestMeta";

export type AuditLevel = "info" | "warn" | "error" | "security";

export type AuditEntry = {
  action: string;
  level?: AuditLevel;
  userId?: string | null;
  email?: string;
  target?: string;
  details?: Record<string, unknown>;
  /** Si ya se tiene (o no hay petición), evita volver a leer las cabeceras. */
  meta?: RequestMeta;
};

export async function audit(e: AuditEntry): Promise<void> {
  try {
    const meta = e.meta ?? (await requestMeta());
    const { error } = await db()
      .from("web_audit_log")
      .insert({
        action: e.action.slice(0, 80),
        level: e.level ?? "info",
        user_id: e.userId ?? null,
        email: (e.email ?? "").toLowerCase().slice(0, 200),
        ip: meta.ip,
        country: meta.country,
        user_agent: meta.userAgent,
        path: meta.path,
        target: (e.target ?? "").slice(0, 300),
        details: e.details ?? {},
      });
    if (error) console.warn(`[audit] ${e.action}: ${error.message}`);
  } catch (err) {
    console.warn(`[audit] ${e.action}:`, err instanceof Error ? err.message : err);
  }
}
