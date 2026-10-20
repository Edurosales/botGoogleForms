/**
 * Configuración editable desde /admin (tabla `app_settings`, fila única).
 *
 * Nota sobre "calcular los recursos del servidor": en un deploy serverless
 * (Vercel) no hay una sola máquina con CPU/RAM fija a la que medirle
 * recursos — cada invocación corre aislada, y el límite real de
 * concurrencia lo imponen las APIs externas (rate limit de Groq, y no
 * parecer abuso ante Google Forms), no el hardware local. `suggestedConcurrency()`
 * da un punto de partida razonable a partir de la memoria asignada a la
 * función (lo único "medible" aquí); el valor que realmente se usa en
 * producción es el que el admin fija en `app_settings` desde el dashboard.
 */
import os from "node:os";
import { db, type AppSettings } from "./db";

export function suggestedConcurrency(): { free: number; paid: number } {
  const totalMb = os.totalmem() / (1024 * 1024);
  // ~1 slot cada 150MB de RAM disponible en la función, acotado a un rango prudente.
  const base = Math.min(6, Math.max(1, Math.floor(totalMb / 150)));
  return { free: Math.max(1, Math.round(base * 0.4)), paid: Math.max(1, Math.round(base * 0.6)) };
}

const DEFAULT_SETTINGS: AppSettings = {
  id: 1,
  credit_packages: [],
  buy_software_url: "",
  whatsapp_number: "",
  whatsapp_message_template: "Hola, quiero que me ayuden a llenar mi formulario: {url} — {total} respuestas",
  free_concurrency: 2,
  paid_concurrency: 3,
  free_daily_cap: 30,
  updated_at: new Date(0).toISOString(),
};

/**
 * Nunca lanza: si Supabase no está configurado todavía (p.ej. recién
 * desplegado, antes de poner las env vars) o hay un error de red, cae a
 * DEFAULT_SETTINGS en vez de reventar la página o el build. Sin este
 * try/catch, `db()` lanza de forma SÍNCRONA cuando faltan las env vars,
 * y eso no es algo que Next pueda diferir detrás de un <Suspense> — rompe
 * el build entero (visto en vivo: build de Vercel falló en
 * /comprar-creditos antes de configurar SUPABASE_URL/SERVICE_KEY).
 */
export async function getAppSettings(): Promise<AppSettings> {
  try {
    const { data } = await db().from("app_settings").select("*").eq("id", 1).maybeSingle<AppSettings>();
    return data ?? DEFAULT_SETTINGS;
  } catch (e) {
    console.error("[appSettings] no se pudo leer la configuración, usando defaults:", e);
    return DEFAULT_SETTINGS;
  }
}

export async function updateAppSettings(patch: Partial<Omit<AppSettings, "id" | "updated_at">>): Promise<AppSettings> {
  const { data, error } = await db()
    .from("app_settings")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", 1)
    .select()
    .single<AppSettings>();
  if (error || !data) throw new Error(error?.message || "No se pudo guardar la configuración.");
  return data;
}
