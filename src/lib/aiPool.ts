/**
 * Grupo de claves de IA con cambio automático. El admin carga varias claves
 * de varios proveedores (Admin → Claves de IA); aquí se prueban en orden de
 * prioridad y, si una falla, se pasa a la siguiente sin cortar el envío:
 *
 *   401/403  clave inválida o vencida   → "invalid"   (fuera hasta que el admin la arregle)
 *   404/410  modelo retirado            → "invalid"   (hay que cambiar el modelo)
 *   429      cuota/límite agotado       → "exhausted" (descansa 10 min)
 *   5xx / tiempo                         → "failing"   (descansa 2 min)
 *
 * Todos los proveedores hablan el mismo formato (API compatible con OpenAI:
 * /chat/completions). Si no hay ninguna clave en la base, se usan las de las
 * variables de entorno (GROQ_API_KEY / NVIDIA_API_KEY) como antes. Si fallan
 * TODAS, se avisa al dueño por correo (una vez por hora).
 */
import { db } from "./db";
import { open } from "./secretBox";
import { alertOwner } from "./alerts";

export type ChatMessage = { role: "system" | "user"; content: string };

type ProviderRow = {
  id: string;
  provider: string;
  label: string;
  base_url: string;
  api_key_enc: string;
  model: string;
  moderation_model: string;
  priority: number;
  cooldown_until: string | null;
  fail_count: number;
};

type Candidate = { id: string | null; name: string; baseUrl: string; key: string; model: string; moderationModel: string };

let cache: { at: number; rows: ProviderRow[] } | null = null;

async function loadRows(): Promise<ProviderRow[]> {
  if (cache && Date.now() - cache.at < 30_000) return cache.rows;
  const { data, error } = await db()
    .from("ai_providers")
    .select("id,provider,label,base_url,api_key_enc,model,moderation_model,priority,cooldown_until,fail_count")
    .eq("enabled", true)
    .neq("status", "invalid")
    .order("priority", { ascending: true });
  const rows = error ? [] : ((data ?? []) as ProviderRow[]);
  cache = { at: Date.now(), rows };
  return rows;
}

function envCandidates(): Candidate[] {
  const out: Candidate[] = [];
  const groq = (process.env.GROQ_API_KEY || "").trim();
  if (groq) {
    out.push({
      id: null,
      name: "Groq (variable de entorno)",
      baseUrl: "https://api.groq.com/openai/v1",
      key: groq,
      model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
      moderationModel: process.env.GROQ_MODERATION_MODEL || "openai/gpt-oss-20b",
    });
  }
  const nvidia = (process.env.NVIDIA_API_KEY || "").trim();
  if (nvidia && process.env.NVIDIA_MODEL) {
    out.push({ id: null, name: "NVIDIA (variable de entorno)", baseUrl: "https://integrate.api.nvidia.com/v1", key: nvidia, model: process.env.NVIDIA_MODEL, moderationModel: "" });
  }
  return out;
}

async function candidates(): Promise<Candidate[]> {
  const now = Date.now();
  const fromDb: Candidate[] = [];
  for (const r of await loadRows()) {
    if (r.cooldown_until && Date.parse(r.cooldown_until) > now) continue;
    try {
      fromDb.push({
        id: r.id,
        name: r.label || r.provider,
        baseUrl: r.base_url.replace(/\/+$/, ""),
        key: open(r.api_key_enc),
        model: r.model,
        moderationModel: r.moderation_model,
      });
    } catch {
      // Clave que no se puede descifrar (cambió el secreto): se ignora.
    }
  }
  // Las de la base van primero; las del entorno quedan como último respaldo.
  return [...fromDb, ...envCandidates()];
}

async function mark(id: string | null, patch: Record<string, unknown>): Promise<void> {
  if (!id) return;
  cache = null;
  await db()
    .from("ai_providers")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .then(
      () => {},
      () => {}
    );
}

function classify(status: number): { status: "invalid" | "exhausted" | "failing"; cooldownMs: number } {
  if (status === 401 || status === 403 || status === 404 || status === 410) return { status: "invalid", cooldownMs: 24 * 3600_000 };
  if (status === 429 || status === 402) return { status: "exhausted", cooldownMs: 10 * 60_000 };
  return { status: "failing", cooldownMs: 2 * 60_000 };
}

export class AiUnavailableError extends Error {}

/**
 * Pide una respuesta probando las claves en orden. `deadline` es el momento
 * límite (la función de Vercel tiene 60 s): no se empieza una clave sin al
 * menos 6 s por delante.
 */
export async function aiChat(
  messages: ChatMessage[],
  opts: { purpose: "generate" | "moderate"; temperature: number; maxTokens: number; deadline?: number; perKeyTimeoutMs?: number }
): Promise<string> {
  const deadline = opts.deadline ?? Date.now() + 55_000;
  const list = await candidates();
  if (!list.length) throw new AiUnavailableError("No hay claves de IA configuradas.");
  const errors: string[] = [];

  for (const c of list) {
    const left = deadline - Date.now();
    if (left < Math.min(6_000, opts.perKeyTimeoutMs ?? 6_000)) break;
    const model = opts.purpose === "moderate" && c.moderationModel ? c.moderationModel : c.model;
    try {
      const res = await fetch(`${c.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${c.key}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ model, messages, temperature: opts.temperature, max_tokens: opts.maxTokens }),
        signal: AbortSignal.timeout(Math.min(opts.perKeyTimeoutMs ?? 25_000, left)),
        cache: "no-store",
      });
      if (!res.ok) {
        const body = (await res.text().catch(() => "")).slice(0, 300);
        const k = classify(res.status);
        errors.push(`${c.name}: ${res.status}`);
        console.error(`[ai] ${c.name} (${model}) respondió ${res.status}: ${body}`);
        await mark(c.id, {
          status: k.status,
          last_error: `${res.status}: ${body}`.slice(0, 300),
          last_error_at: new Date().toISOString(),
          cooldown_until: new Date(Date.now() + k.cooldownMs).toISOString(),
        });
        continue;
      }
      const json = await res.json();
      const text = json?.choices?.[0]?.message?.content;
      if (typeof text !== "string" || !text.trim()) {
        errors.push(`${c.name}: respuesta vacía`);
        continue;
      }
      await mark(c.id, { status: "ok", last_ok_at: new Date().toISOString(), cooldown_until: null, fail_count: 0 });
      return text.trim();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${c.name}: ${msg}`);
      console.error(`[ai] ${c.name} falló:`, msg);
      await mark(c.id, {
        status: "failing",
        last_error: msg.slice(0, 300),
        last_error_at: new Date().toISOString(),
        cooldown_until: new Date(Date.now() + 2 * 60_000).toISOString(),
      });
    }
  }

  await alertOwner("ai-all-failed", "Ninguna clave de IA responde", {
    Uso: opts.purpose === "moderate" ? "Revisión de formularios" : "Generar respuestas",
    Errores: errors.join(" | ").slice(0, 600) || "sin claves disponibles",
    "Qué hacer": "Admin → Claves de IA: agrega una clave nueva o cambia el modelo.",
  });
  throw new AiUnavailableError(`Ninguna clave de IA respondió (${errors.join(" | ").slice(0, 300)})`);
}
