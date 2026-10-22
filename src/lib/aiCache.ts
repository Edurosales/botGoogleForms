/**
 * Banco de respuestas de IA: cada respuesta abierta que genera la IA se
 * guarda por pregunta (normalizada), idioma e instrucciones; si otro envío
 * pregunta lo mismo (o algo parecido, pg_trgm), se reutilizan en vez de
 * llamar otra vez a la IA. Así el servicio aprende con el uso y gasta menos.
 *
 * Reglas para que siga pareciendo aleatorio:
 * - Dentro de un envío nunca se repite una respuesta (se excluyen las usadas).
 * - Primero las menos usadas, al azar entre iguales.
 * - Solo se evita la IA si el banco tiene de sobra (POOL_FACTOR × lo pedido)
 *   y, aun así, una parte de las veces se pide a la IA (FRESH_RATIO) para que
 *   el banco siga creciendo y variando.
 * Cualquier fallo (tabla sin crear, red) vuelve al camino normal con IA.
 */
import { createHash } from "node:crypto";
import { db } from "./db";

const POOL_FACTOR = 3;
const MIN_POOL = 30;
const FRESH_RATIO = 0.3;

export function normalizeQuestion(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/** Huella de las instrucciones: respuestas de "estudiantes de medicina" no se mezclan con otras. */
export function contextKey(questionPrompt: string, customInstructions: string): string {
  const raw = `${questionPrompt.trim().toLowerCase()}|${customInstructions.trim().toLowerCase()}`;
  return raw === "|" ? "" : createHash("sha1").update(raw).digest("hex").slice(0, 16);
}

const hash = (s: string) => createHash("sha1").update(s).digest("hex");

export type CacheKey = { norm: string; lang: string; ctx: string };

/** `n` respuestas distintas del banco (sin las excluidas) o null si no alcanza. */
async function pick(key: CacheKey, n: number, exclude: string[]): Promise<{ ids: number[]; answers: string[] } | null> {
  const want = Math.max(n * POOL_FACTOR, MIN_POOL);
  const { data, error } = await db().rpc("ai_cache_pick", {
    p_norm: key.norm,
    p_lang: key.lang,
    p_ctx: key.ctx,
    p_exclude: exclude.slice(-2000),
    p_limit: want,
  });
  if (error || !Array.isArray(data) || data.length < want) return null;
  const rows = data as { id: number; answer: string }[];
  const seen = new Set<string>();
  const chosen: { id: number; answer: string }[] = [];
  for (const r of rows) {
    if (seen.has(r.answer)) continue;
    seen.add(r.answer);
    chosen.push(r);
    if (chosen.length === n) break;
  }
  return chosen.length === n ? { ids: chosen.map((c) => c.id), answers: chosen.map((c) => c.answer) } : null;
}

/**
 * Intenta armar las respuestas de TODAS las preguntas abiertas desde el banco.
 * Devuelve un mapa clave→respuestas (una por perfil) o null para usar la IA.
 */
export async function answersFromCache(
  keys: Map<string, CacheKey>,
  n: number,
  usedByEntry: Record<string, string[]>
): Promise<Map<string, string[]> | null> {
  if (keys.size === 0 || Math.random() < FRESH_RATIO) return null;
  try {
    const out = new Map<string, string[]>();
    const touched: number[] = [];
    for (const [entry, key] of keys) {
      const got = await pick(key, n, usedByEntry[entry] ?? []);
      if (!got) return null;
      out.set(entry, got.answers);
      touched.push(...got.ids);
    }
    await db().rpc("ai_cache_touch", { p_ids: touched });
    return out;
  } catch {
    return null;
  }
}

/** Guarda en el banco las respuestas nuevas de la IA (las repetidas se ignoran). */
export async function storeAnswers(keys: Map<string, CacheKey>, profiles: Record<string, string>[]): Promise<void> {
  try {
    const rows: Record<string, unknown>[] = [];
    for (const [entry, key] of keys) {
      for (const p of profiles) {
        const answer = (p[entry] ?? "").trim();
        // Respuestas muy cortas o muy largas no aportan al banco.
        if (answer.length < 2 || answer.length > 1000) continue;
        rows.push({ q_norm: key.norm, lang: key.lang, ctx: key.ctx, answer, answer_hash: hash(answer) });
      }
    }
    if (!rows.length) return;
    await db().from("ai_answer_cache").upsert(rows, { onConflict: "q_norm,lang,ctx,answer_hash", ignoreDuplicates: true });
  } catch (e) {
    console.warn("[aiCache] no se pudo guardar:", e instanceof Error ? e.message : e);
  }
}
