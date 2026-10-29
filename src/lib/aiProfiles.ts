/**
 * Generación de perfiles de respuesta con Groq (un solo call para N perfiles)
 * y moderación de contenido previa. Puerto simplificado de
 * app/core/ai_client.py (ver PROYECTO.md) — a diferencia del bot de
 * escritorio, aquí NO hay claves de usuario: el servicio usa su propia
 * GROQ_API_KEY para todos, compartida entre todos los usuarios del
 * servicio web. Por eso "fixed"/"random" se resuelven en JS (ver
 * dataGen.ts, puerto de data_gen.py) en vez de seguir gastando tokens
 * de Groq como hace el bot de escritorio (ahí cada usuario tiene su
 * propia API key, así que ese costo nunca fue un problema compartido).
 */

import type { ParsedForm, ParsedQuestion } from "./formParser";
import { createNameState, smartRandom, isNameField, isEmailField, conformToValidation, type NameState } from "./dataGen";
import { answersFromCache, contextKey, normalizeQuestion, storeAnswers, type CacheKey } from "./aiCache";
import { aiChat } from "./aiPool";
import { routeProfile } from "./formRoute";

export type QuestionMode = "ai" | "random" | "fixed" | "weighted" | "list";

export interface QuestionConfig {
  mode?: QuestionMode;
  value?: string;
  prompt?: string;
  /** Modo "weighted": % por opción, alineado con `question.options`. */
  weights?: number[];
  /** Modo "list": usar las líneas en orden (respuesta 1 → línea 1…) o al azar. */
  order?: "random" | "sequential";
  /**
   * Condiciones: "si la pregunta `entry` responde `equals`, esta pregunta
   * responde `value`" (value "" = dejarla vacía, p. ej. una pregunta que solo
   * se abre si marcan "Sí"). La primera que se cumpla gana.
   */
  when?: { entry: string; equals: string; value: string }[];
}

/** Aplica las condiciones entre preguntas a cada respuesta ya generada. */
function applyRules(profiles: Record<string, string>[], questions: ParsedQuestion[], qConfig: QuestionConfigMap): Record<string, string>[] {
  const byEntry = new Map(questions.map((q) => [q.entry, q]));
  const ruled = questions.filter((q) => (qConfig[q.entry]?.when ?? []).length);
  if (!ruled.length) return profiles;
  return profiles.map((p) => {
    const out = { ...p };
    for (const q of ruled) {
      for (const r of qConfig[q.entry]?.when ?? []) {
        const src = out[r.entry] ?? "";
        // Casillas: la respuesta trae varias opciones separadas por "|".
        const hit = src.split("|").map((v) => v.trim()).includes(r.equals.trim());
        if (!hit) continue;
        const target = byEntry.get(q.entry);
        if (r.value === "") delete out[q.entry];
        else if (!target?.options.length || target.options.includes(r.value)) out[q.entry] = r.value;
        break;
      }
    }
    return out;
  });
}

/** Líneas de una lista pegada (una respuesta por línea; también acepta `|`). */
export function listLines(value: string | undefined): string[] {
  const raw = value ?? "";
  const parts = raw.includes("\n") ? raw.split(/\r?\n/) : raw.split("|");
  return parts.map((s) => s.trim()).filter(Boolean);
}

export type QuestionConfigMap = Record<string, QuestionConfig>;

// Modelos por defecto de Groq (solo para las claves de las variables de
// entorno; las claves cargadas en el panel traen su propio modelo).
const GENERATION_MODEL = "generate";
const MODERATION_MODEL = "moderate";

/**
 * Llama a la IA con el grupo de claves del panel (aiPool.ts): prueba en
 * orden de prioridad y cambia sola de clave/proveedor si una falla.
 */
async function callGroq(
  messages: { role: "system" | "user"; content: string }[],
  model: string,
  temperature: number,
  maxTokens: number
): Promise<string> {
  return aiChat(messages, { purpose: model === MODERATION_MODEL ? "moderate" : "generate", temperature, maxTokens });
}

// ── Resolución local (sin IA) para preguntas "fixed"/"random" ────
// Antes, "fixed"/"random" solo le daban una PISTA a la IA dentro del
// mismo prompt — la pregunta seguía gastando tokens de Groq igual.
// Ahora se resuelven aquí mismo, en JS, sin ninguna llamada a la API:
// menos tokens por formulario y cero riesgo de rate limit en esas
// preguntas. Reduce costo real y reduce la carga sobre Groq.

function parseFixedOptions(value: string): string[] | null {
  if (value.includes("|")) return value.split("|").map((v) => v.trim()).filter(Boolean);
  if (value.startsWith("{") && value.endsWith("}")) {
    return value.slice(1, -1).split(",").map((v) => v.trim()).filter(Boolean);
  }
  return null;
}

/**
 * Modo efectivo de una pregunta. Un modo que no es "ai" NUNCA cae en Groq:
 * antes, "Fijo" sin valor o "Lista pegada" vacía se trataban como IA, así
 * que un envío gratis podía terminar llamando a Groq (IA gratis / cuota
 * gastada). Ahora esos casos incompletos se llenan como Aleatorio.
 */
function effectiveMode(q: ParsedQuestion, cfg: QuestionConfig): QuestionMode {
  // Solo es IA lo que dice explícitamente "ai": una pregunta sin config o con
  // un modo desconocido nunca debe terminar gastando Groq.
  const mode = cfg.mode;
  if (mode === "ai") return "ai";
  if (mode === "fixed") return (cfg.value ?? "").trim() ? "fixed" : "random";
  if (mode === "list") return listLines(cfg.value).length ? "list" : "random";
  if (mode === "weighted") return q.options.length ? "weighted" : "random";
  return "random";
}

function isLocallyResolvable(q: ParsedQuestion, cfg: QuestionConfig): boolean {
  return effectiveMode(q, cfg) !== "ai";
}

/** true si ALGUNA pregunta necesita Groq — permite saber, sin generar
 * nada, si un job puede tratarse como "sin IA" (generar todo de una vez,
 * sin los límites de tokens/minuto de Groq). */
export function needsAi(questions: ParsedQuestion[], qConfig: QuestionConfigMap): boolean {
  return questions.some((q) => !isLocallyResolvable(q, qConfig[q.entry] ?? {}));
}

/** Resuelve un perfil completo de preguntas locales, con nombre y correo
 * coherentes entre sí dentro del mismo perfil (igual que el bot de
 * escritorio): si hay una pregunta de nombre, se resuelve primero y su
 * valor alimenta la generación del correo. */
/** Elige según porcentajes. Opción única: una opción ponderada. Casillas:
 * cada opción se marca con su % de probabilidad (al menos una). */
function pickWeighted(q: ParsedQuestion, weights: number[] | undefined): string {
  const w = q.options.map((_, i) => Math.max(0, Number(weights?.[i]) || 0));
  const sum = w.reduce((a, b) => a + b, 0);
  if (sum <= 0) return q.options[Math.floor(Math.random() * q.options.length)];
  if (q.type === 4 || q.type === 13) {
    const chosen = q.options.filter((_, i) => Math.random() * 100 < w[i]);
    if (chosen.length) return chosen.join("|");
    return q.options[w.indexOf(Math.max(...w))];
  }
  let r = Math.random() * sum;
  for (let i = 0; i < w.length; i++) {
    r -= w[i];
    if (r < 0) return q.options[i];
  }
  return q.options[q.options.length - 1];
}

function resolveLocalPart(
  questions: ParsedQuestion[],
  qConfig: QuestionConfigMap,
  state: NameState,
  index: number
): Record<string, string> {
  const part: Record<string, string> = {};
  let resolvedName: string | undefined;

  for (const q of questions) {
    const cfg = qConfig[q.entry] ?? {};
    const mode = effectiveMode(q, cfg);
    if (mode === "list") {
      // En preguntas de opciones solo valen líneas que existen como opción
      // (si no, Google rechaza la respuesta entera).
      const all = listLines(cfg.value);
      const valid = q.options.length ? all.filter((l) => q.options.includes(l)) : all;
      const lines = valid.length ? valid : q.options.length ? q.options : all;
      part[q.entry] =
        cfg.order === "sequential" ? lines[index % lines.length] : lines[Math.floor(Math.random() * lines.length)];
      if (isNameField(q) && !q.options.length) resolvedName = part[q.entry];
    } else if (mode === "weighted") {
      part[q.entry] = pickWeighted(q, cfg.weights);
    }
  }

  for (const q of questions) {
    const mode = effectiveMode(q, qConfig[q.entry] ?? {});
    if (part[q.entry] === undefined && mode === "random" && !q.options.length && isNameField(q)) {
      resolvedName = smartRandom(q, state);
      part[q.entry] = resolvedName;
    }
  }

  for (const q of questions) {
    if (part[q.entry] !== undefined) continue;
    const cfg = qConfig[q.entry] ?? {};
    const mode = effectiveMode(q, cfg);

    if (mode === "random") {
      if (q.options.length) {
        if (q.type === 4 || q.type === 13) {
          // Casillas / cuadrícula de casillas: 1-3 opciones, como el bot de escritorio.
          const n = 1 + Math.floor(Math.random() * Math.min(3, q.options.length));
          const shuffled = [...q.options].sort(() => Math.random() - 0.5);
          part[q.entry] = shuffled.slice(0, n).join("|");
        } else {
          part[q.entry] = q.options[Math.floor(Math.random() * q.options.length)];
        }
      } else if (isEmailField(q)) {
        part[q.entry] = state.randomEmailFromName(resolvedName);
      } else {
        part[q.entry] = smartRandom(q, state);
      }
      continue;
    }

    const value = (cfg.value ?? "").trim();
    const parsed = parseFixedOptions(value) ?? (q.options.length ? [value] : null);
    // En preguntas de opciones, "Fijo" son opciones elegidas en pantalla: se
    // descartan las que no existen en el formulario.
    const opts = parsed && q.options.length ? parsed.filter((o) => q.options.includes(o)) : parsed;
    if (q.options.length && (q.type === 4 || q.type === 13) && opts?.length) {
      // Casillas: se marcan TODAS las elegidas.
      part[q.entry] = opts.join("|");
      continue;
    }
    if (opts && opts.length) {
      part[q.entry] = opts[Math.floor(Math.random() * opts.length)];
      continue;
    }
    if (q.options.length) {
      part[q.entry] = q.options[Math.floor(Math.random() * q.options.length)];
      continue;
    }
    // Rango de fechas "2025-01-01~2025-12-31".
    const dr = value.match(/^(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})$/);
    if (dr) {
      const a = Date.parse(`${dr[1]}T12:00:00Z`);
      const b = Date.parse(`${dr[2]}T12:00:00Z`);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        part[q.entry] = new Date(lo + Math.floor(Math.random() * ((hi - lo) / 86_400_000 + 1)) * 86_400_000).toISOString().slice(0, 10);
        continue;
      }
    }
    // Rango de horas "08:00~18:30".
    const tr = value.match(/^(\d{1,2}):(\d{2})\s*~\s*(\d{1,2}):(\d{2})$/);
    if (tr) {
      const a = Number(tr[1]) * 60 + Number(tr[2]);
      const b = Number(tr[3]) * 60 + Number(tr[4]);
      const m = Math.min(a, b) + Math.floor(Math.random() * (Math.abs(b - a) + 1));
      part[q.entry] = `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      continue;
    }
    const rng = value.match(/^(\d{1,9})\s*[-–]\s*(\d{1,9})$/);
    if (rng) {
      // Acepta el rango al revés ("65-18") sin generar números fuera de él.
      const a = parseInt(rng[1], 10);
      const b = parseInt(rng[2], 10);
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      part[q.entry] = String(lo + Math.floor(Math.random() * (hi - lo + 1)));
      continue;
    }
    part[q.entry] = value;
  }

  return part;
}

// ── Prompt builder (puerto de _build_prompt) ─────────────────────

function buildPrompt(
  formTitle: string,
  questions: ParsedQuestion[],
  nProfiles: number,
  customInstructions: string,
  qConfig: QuestionConfigMap,
  language: string
): string {
  const lines: string[] = [
    `Formulario: "${formTitle}"`,
    `Tarea: genera ${nProfiles} respuesta(s) realistas y DIFERENTES entre sí.`,
    `Idioma de las respuestas: ${language} (TODAS las respuestas de texto libre deben estar en este idioma).`,
    "",
  ];

  if (customInstructions.trim()) {
    lines.push(
      "╔══════════════════════════════════════════════════════════╗",
      "║  PERSONA / ROL  —  CUMPLE ESTO AL PIE DE LA LETRA         ║",
      "╚══════════════════════════════════════════════════════════╝",
      customInstructions.trim(),
      "",
      "REGLAS DE PERSONA (OBLIGATORIAS):",
      "- DEBES generar TODAS las respuestas como si fueras EXACTAMENTE esa persona.",
      "- Adapta el NOMBRE, EDAD, vocabulario, opiniones y estilo al perfil descrito.",
      "- Cada perfil debe ser DIFERENTE (distintos nombres, pequeñas variaciones)",
      "  pero siempre coherente con la persona descrita arriba.",
      "",
      "INSTRUCCIONES GENERALES:"
    );
  } else {
    lines.push(
      "INSTRUCCIONES:",
      "- Crea personas ficticias variadas (distintas edades, perfiles, personalidades).",
      "- Cada perfil debe ser internamente coherente.",
      "- Usa nombres realistas del idioma indicado y NO repitas el mismo nombre."
    );
  }

  lines.push(
    "- Para opción múltiple: usa EXACTAMENTE el texto de una de las opciones dadas.",
    "- Para texto libre: respuesta corta y natural (máx 15 palabras).",
    "- Si una pregunta pide nombre completo: genera Nombre + DOS apellidos distintos, sin repetir apellidos entre perfiles.",
    "- Para edad: número entero realista y coherente con el perfil."
  );

  lines.push("", "PREGUNTAS:", "");

  questions.forEach((q, idx) => {
    const i = idx + 1;
    const cfg = qConfig[q.entry] ?? {};
    const mode: QuestionMode = cfg.mode ?? "ai";
    const value = (cfg.value ?? "").trim();
    const qPrompt = (cfg.prompt ?? "").trim();

    let hint = "";
    if (mode === "fixed" && value) {
      if (value.includes("|")) {
        const opts = value.split("|").map((v) => v.trim()).filter(Boolean);
        hint = `  [RESTRICCIÓN: elige UNA de estas opciones al azar: ${opts.join(" | ")}]`;
      } else if (value.startsWith("{") && value.endsWith("}")) {
        const opts = value.slice(1, -1).split(",").map((v) => v.trim()).filter(Boolean);
        hint = `  [RESTRICCIÓN: elige UNA de estas opciones al azar: ${opts.join(" | ")}]`;
      } else {
        const rng = value.match(/^(\d+)\s*[-–]\s*(\d+)$/);
        hint = rng
          ? `  [RESTRICCIÓN: número entre ${rng[1]} y ${rng[2]}]`
          : `  [RESTRICCIÓN: responde EXACTAMENTE "${value}"]`;
      }
    } else if (mode === "random") {
      hint = "  [INSTRUCCIÓN: elige al azar entre las opciones disponibles]";
    }

    let promptHint = "";
    if (mode === "ai" && qPrompt) {
      promptHint = `  [INSTRUCCIÓN ESPECÍFICA PARA ESTA PREGUNTA: ${qPrompt}]`;
    }

    const tLow = q.title.toLowerCase();
    if (!q.options.length && mode === "ai") {
      if (/\b(dni|ruc|celular|telefono|teléfono|phone|edad|age|cantidad|monto|año|year|código|codigo|postal|zip)\b/.test(tLow)) {
        if (!/número|numero|dígito/i.test(promptHint)) {
          promptHint += "  [VALIDACIÓN: responde ÚNICAMENTE con dígitos numéricos enteros, sin palabras ni letras]";
        }
      } else if (/\b(correo|email|e-mail)\b/.test(tLow)) {
        if (!/correo|email/i.test(promptHint)) {
          promptHint += "  [VALIDACIÓN: escribe un correo electrónico válido como usuario@gmail.com]";
        }
      }
    }

    let typeHint = "";
    switch (q.type) {
      case 9:
        typeHint = "  [Fecha → AAAA-MM-DD]";
        break;
      case 10:
        typeHint = "  [Hora → HH:MM en 24h]";
        break;
      case 4:
        typeHint = "  [Casillas → 1-3 opciones separadas por |]";
        break;
      case 5: {
        const opts = q.options;
        const rng = opts.length >= 2 ? `${opts[0]}–${opts[opts.length - 1]}` : "1–5";
        typeHint = `  [Escala lineal ${rng} → número entero]`;
        break;
      }
      case 7:
        typeHint = "  [Cuadrícula → elige exactamente una columna]";
        break;
      case 13:
        typeHint = "  [Cuadrícula de casillas → una o más columnas separadas por |]";
        break;
    }

    lines.push(`P${i}: ${q.title}${hint}${promptHint}${typeHint}`);
    lines.push(q.options.length ? `     Opciones: ${q.options.join(" | ")}` : "     [Texto libre]");
  });

  lines.push(
    "",
    "RESPONDE SOLO con JSON válido. Sin markdown. Sin texto extra.",
    "Para Casillas: separa las opciones elegidas con |  (ej: Opción A|Opción C)",
    "Para Fecha: usa formato AAAA-MM-DD  (ej: 1995-06-15)",
    "Para Hora: usa formato HH:MM en 24h  (ej: 14:30)",
    `Formato: array con ${nProfiles} objeto(s): [{"P1":"...","P2":"...",...}, ...]`
  );

  return lines.join("\n");
}

// ── Parseo tolerante de JSON de la IA (puerto reducido) ──────────

function cleanAndParseJson(text: string): unknown[] {
  if (!text) throw new Error("La respuesta de la IA llegó vacía.");

  const clean = text.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();

  const firstBracket = clean.indexOf("[");
  const firstBrace = clean.indexOf("{");
  let start = -1;
  let end = -1;
  if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
    start = firstBracket;
    end = clean.lastIndexOf("]");
  } else if (firstBrace !== -1) {
    start = firstBrace;
    end = clean.lastIndexOf("}");
  }
  const candidate = start !== -1 && end !== -1 && end > start ? clean.slice(start, end + 1) : clean;

  const tryParse = (s: string): unknown | undefined => {
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  };

  let parsed = tryParse(candidate);
  if (parsed === undefined) {
    const sanitized = candidate
      .replace(/\/\/.*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\bTrue\b/g, "true")
      .replace(/\bFalse\b/g, "false")
      .replace(/\bNone\b/g, "null")
      .replace(/,\s*([\]}])/g, "$1")
      .replace(/'([a-zA-Z0-9_]+)'\s*:/g, '"$1":')
      .replace(/([{,\s])([a-zA-Z0-9_]+)\s*:/g, '$1"$2":');
    parsed = tryParse(sanitized);
  }

  if (parsed === undefined) {
    throw new Error(`No se pudo interpretar el JSON de la IA. Respuesta:\n${text.slice(0, 200)}`);
  }

  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    for (const key of ["profiles", "respuestas", "answers", "data", "results", "items"]) {
      const v = (parsed as Record<string, unknown>)[key];
      if (Array.isArray(v)) return v;
    }
    return [parsed];
  }
  throw new Error("La IA devolvió un formato inesperado.");
}

// ── Generación de perfiles ────────────────────────────────────────

export interface GenerateProfilesOptions {
  nProfiles: number;
  customInstructions?: string;
  qConfig?: QuestionConfigMap;
  language?: string;
  /** Índice global de la primera respuesta de este lote (para listas "en orden"). */
  startIndex?: number;
  /** Respuestas ya usadas en este envío por pregunta: el banco de IA no las repite. */
  usedAnswers?: Record<string, string[]>;
}

/** Retorna perfiles como Record<entry, respuesta>, uno por respuesta a enviar. */
/** Genera las respuestas y aplica las condiciones entre preguntas. */
export async function generateProfiles(form: ParsedForm, opts: GenerateProfilesOptions): Promise<Record<string, string>[]> {
  const profiles = await generateProfilesRaw(form, opts);
  // Primero las condiciones del usuario, después el recorrido por secciones
  // (las preguntas de secciones que no se visitan quedan vacías).
  return applyRules(profiles, form.questions, opts.qConfig ?? {}).map((p) => routeProfile(p, form.questions, form.numSections));
}

async function generateProfilesRaw(
  form: ParsedForm,
  opts: GenerateProfilesOptions
): Promise<Record<string, string>[]> {
  const qConfig = opts.qConfig ?? {};
  const language = opts.language ?? "español";
  const n = opts.nProfiles;

  // Preguntas "fixed"/"random" se resuelven aquí mismo, sin tocar Groq.
  // Solo las que de verdad necesitan generación con IA se mandan al
  // prompt — si no queda ninguna, el lote completo sale gratis y sin
  // riesgo de rate limit.
  const aiQuestions = form.questions.filter((q) => !isLocallyResolvable(q, qConfig[q.entry] ?? {}));
  const localQuestions = form.questions.filter((q) => isLocallyResolvable(q, qConfig[q.entry] ?? {}));
  // Un solo estado (pools de nombres/apellidos/correos sin repetir) para
  // toda la tanda, igual que el bot de escritorio.
  const nameState: NameState = createNameState(language);
  const start = opts.startIndex ?? 0;
  const buildLocalPart = (i: number): Record<string, string> =>
    resolveLocalPart(localQuestions, qConfig, nameState, start + i);

  if (aiQuestions.length === 0) {
    return Array.from({ length: n }, (_, i) => buildLocalPart(i));
  }

  // Banco de respuestas: las preguntas abiertas con IA pueden salir de lo
  // ya generado antes para preguntas iguales o parecidas (ver aiCache.ts).
  const openAi = aiQuestions.filter((q) => !q.options.length);
  const cacheKeys = new Map<string, CacheKey>(
    openAi.map((q) => [
      q.entry,
      { norm: normalizeQuestion(q.title), lang: language, ctx: contextKey(qConfig[q.entry]?.prompt ?? "", opts.customInstructions ?? "") },
    ])
  );
  // Solo si TODAS las preguntas con IA son abiertas (las de opciones necesitan
  // el criterio de la IA para ser coherentes con el resto del perfil).
  if (openAi.length === aiQuestions.length) {
    const cached = await answersFromCache(cacheKeys, n, opts.usedAnswers ?? {});
    if (cached) {
      return Array.from({ length: n }, (_, i) => {
        const profile = buildLocalPart(i);
        for (const q of openAi) profile[q.entry] = conformToValidation(q, cached.get(q.entry)?.[i] ?? "", nameState);
        return profile;
      });
    }
  }

  const prompt = buildPrompt(form.title, aiQuestions, n, opts.customInstructions ?? "", qConfig, language);

  const text = await callGroq(
    [
      {
        role: "system",
        content: "Eres un asistente que genera únicamente datos estructurados en formato JSON estrictamente válido.",
      },
      { role: "user", content: prompt },
    ],
    GENERATION_MODEL,
    0.8,
    // Modelo de razonamiento: gasta tokens pensando antes de escribir el
    // JSON final. Con 30 perfiles y varias preguntas, 4096 se quedaba
    // corto. 16000 causó un rechazo inmediato de la API (probablemente
    // por encima del máximo que Groq permite para este modelo) — 8192
    // es un valor ampliamente soportado y sigue siendo el doble.
    8192
  );

  const rawProfiles = cleanAndParseJson(text);

  const generated = rawProfiles.map((raw, pIdx) => {
    const r = raw as Record<string, unknown>;
    const profile: Record<string, string> = buildLocalPart(pIdx);
    aiQuestions.forEach((q: ParsedQuestion, idx) => {
      const i = idx + 1;
      let answer = String(r[`P${i}`] ?? r[`p${i}`] ?? "").trim();
      if (q.options.length && !q.options.includes(answer)) {
        const match = q.options.find((opt) => opt.trim().toLowerCase() === answer.toLowerCase());
        answer = match ?? q.options[Math.floor(Math.random() * q.options.length)];
      } else if (!q.options.length) {
        // La IA a veces escribe "veinticinco" o "25 años": si el dueño puso
        // una validación (número en rango, correo), se corrige aquí antes de
        // que Google rechace el envío entero.
        answer = conformToValidation(q, answer, nameState);
      }
      profile[q.entry] = answer;
    });
    return profile;
  });
  await storeAnswers(cacheKeys, generated);
  return generated;
}

// ── Moderación de contenido ───────────────────────────────────────

export interface ModerationResult {
  allowed: boolean;
  reason: string;
}

/** Clasifica si el formulario es apto (rechaza concursos/sorteos/elecciones/ilegal). */
export async function moderateForm(form: ParsedForm): Promise<ModerationResult> {
  const questionTitles = form.questions.slice(0, 40).map((q, i) => `${i + 1}. ${q.title}`).join("\n");

  const prompt = [
    "Evalúa si este formulario de Google Forms puede ser respondido automáticamente por un servicio de pruebas.",
    "RECHAZA (allowed=false) si el formulario es, o parece ser, cualquiera de estas cosas:",
    "- Un concurso, sorteo, rifa o giveaway con premio.",
    "- Una votación, elección, encuesta electoral o postulación oficial.",
    "- Cualquier actividad regulada o ilegal (apuestas, trámites legales vinculantes, datos financieros sensibles de terceros).",
    "ACEPTA (allowed=true) formularios normales de prueba, feedback, inscripciones internas, encuestas de opinión no electorales, etc.",
    "",
    `Título: "${form.title}"`,
    form.description ? `Descripción: "${form.description}"` : "",
    "Preguntas:",
    questionTitles,
    "",
    'Responde SOLO con JSON: {"allowed": true|false, "reason": "motivo breve en español"}',
  ]
    .filter(Boolean)
    .join("\n");

  const text = await callGroq(
    [
      { role: "system", content: "Eres un moderador de contenido estricto. Responde solo JSON válido." },
      { role: "user", content: prompt },
    ],
    MODERATION_MODEL,
    0.1,
    600
  );

  try {
    const parsed = cleanAndParseJson(text)[0] as { allowed?: boolean; reason?: string } | undefined;
    if (parsed && typeof parsed.allowed === "boolean") {
      return { allowed: parsed.allowed, reason: parsed.reason ?? "" };
    }
  } catch {
    // respuesta ilegible: se decide con la revisión local
  }
  return heuristicModeration(form);
}

const BLOCKED_KEYWORDS = [
  "sorteo", "rifa", "concurso", "giveaway", "premio", "ganador", "ganadora",
  "votacion", "votación", "vota por", "voto", "eleccion", "elección", "candidato", "candidata",
  "apuesta", "casino",
];

/** Revisión local por palabras clave — solo se usa si Groq no responde. */
export function heuristicModeration(form: ParsedForm): ModerationResult {
  const text = [form.title, form.description, ...form.questions.map((q) => q.title)].join(" \n ").toLowerCase();
  const hit = BLOCKED_KEYWORDS.find((k) => new RegExp(`(^|[^a-záéíóúñ])${k}([^a-záéíóúñ]|$)`).test(text));
  return hit
    ? { allowed: false, reason: `Este formulario parece un concurso, sorteo o votación ("${hit}"), y eso no lo podemos procesar.` }
    : { allowed: true, reason: "" };
}

/**
 * Moderación que nunca bloquea al usuario por una caída de Groq (límite
 * diario agotado, red): en ese caso cae a la revisión por palabras clave.
 */
export async function moderateFormSafe(form: ParsedForm): Promise<ModerationResult> {
  try {
    return await moderateForm(form);
  } catch (e) {
    console.error("[moderation] Groq no disponible, usando revisión local:", e instanceof Error ? e.message : e);
    return heuristicModeration(form);
  }
}

/** Llamada corta a Groq que debe devolver un objeto JSON (recomendaciones, etc.). */
export async function callGroqJson(prompt: string, maxTokens: number): Promise<unknown> {
  const text = await callGroq(
    [
      { role: "system", content: "Eres un experto en Google Forms. Responde siempre SOLO con JSON válido, sin markdown." },
      { role: "user", content: prompt },
    ],
    MODERATION_MODEL,
    0.2,
    maxTokens
  );
  return cleanAndParseJson(text)[0];
}
