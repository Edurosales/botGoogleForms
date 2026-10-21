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

export type QuestionMode = "ai" | "random" | "fixed" | "weighted" | "list";

export interface QuestionConfig {
  mode?: QuestionMode;
  value?: string;
  prompt?: string;
  /** Modo "weighted": % por opción, alineado con `question.options`. */
  weights?: number[];
  /** Modo "list": usar las líneas en orden (respuesta 1 → línea 1…) o al azar. */
  order?: "random" | "sequential";
}

/** Líneas de una lista pegada (una respuesta por línea; también acepta `|`). */
export function listLines(value: string | undefined): string[] {
  const raw = value ?? "";
  const parts = raw.includes("\n") ? raw.split(/\r?\n/) : raw.split("|");
  return parts.map((s) => s.trim()).filter(Boolean);
}

export type QuestionConfigMap = Record<string, QuestionConfig>;

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
// NOTA (2026-10-20): los modelos "llama-3.x" ya no existen en el catálogo
// de Groq para esta cuenta (comprobado en vivo: "model_not_found"). Se
// usan los modelos "openai/gpt-oss-*" que Groq sirve actualmente. Son
// modelos de razonamiento: gastan tokens de "reasoning" antes del
// contenido final, por eso maxTokens va holgado (ver callGroq).
const GENERATION_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
const MODERATION_MODEL = process.env.GROQ_MODERATION_MODEL || "openai/gpt-oss-20b";

function groqApiKey(): string {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("Falta GROQ_API_KEY en el entorno del servidor.");
  return key;
}

const GROQ_TIMEOUT_MS = 20_000;
const GROQ_MAX_RETRY_WAIT_MS = 10_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGroq(
  messages: { role: "system" | "user"; content: string }[],
  model: string,
  temperature: number,
  maxTokens: number,
  retriesLeft = 1
): Promise<string> {
  const res = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${groqApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
    // Peor caso dentro de maxDuration=60 s: 20 s + espera ≤10 s + 20 s.
    signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // Groq dice cuánto esperar ("Please try again in 10.22s"): se reintenta
    // una vez solo si esa espera cabe en el tiempo de la función; si no
    // (p. ej. límite diario agotado, "2m35s"), se falla de inmediato.
    if (res.status === 429 && retriesLeft > 0) {
      const wait = body.match(/try again in ([\d.]+)s/i);
      const waitMs = wait ? Math.ceil(parseFloat(wait[1]) * 1000) + 500 : 5000;
      if (waitMs <= GROQ_MAX_RETRY_WAIT_MS) {
        console.error(`[callGroq] 429, reintentando en ${waitMs}ms:`, body.slice(0, 200));
        await sleep(waitMs);
        return callGroq(messages, model, temperature, maxTokens, retriesLeft - 1);
      }
    }
    throw new Error(`Groq respondió ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("La respuesta de la IA llegó vacía.");
  }
  return text.trim();
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
  const mode: QuestionMode = cfg.mode ?? "ai";
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
      const lines = listLines(cfg.value);
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
    const opts = parseFixedOptions(value);
    if (opts && opts.length) {
      part[q.entry] = opts[Math.floor(Math.random() * opts.length)];
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
}

/** Retorna perfiles como Record<entry, respuesta>, uno por respuesta a enviar. */
export async function generateProfiles(
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

  return rawProfiles.map((raw, pIdx) => {
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
