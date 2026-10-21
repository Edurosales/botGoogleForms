/**
 * Generación de perfiles de respuesta con Groq (un solo call para N perfiles)
 * y moderación de contenido previa. Puerto simplificado de
 * app/core/ai_client.py (ver PROYECTO.md) — a diferencia del bot de
 * escritorio, aquí NO hay claves de usuario: el servicio usa su propia
 * GROQ_API_KEY para todos. Tampoco se porta el post-procesamiento de
 * nombres/apellidos de data_gen.py (fuera de alcance del MVP).
 */

import type { ParsedForm, ParsedQuestion } from "./formParser";

export type QuestionMode = "ai" | "random" | "fixed";

export interface QuestionConfig {
  mode?: QuestionMode;
  value?: string;
  prompt?: string;
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

async function callGroq(
  messages: { role: "system" | "user"; content: string }[],
  model: string,
  temperature: number,
  maxTokens: number
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
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Groq respondió ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("La respuesta de la IA llegó vacía.");
  }
  return text.trim();
}

// ── Prompt builder (puerto de _build_prompt) ─────────────────────

function buildPrompt(
  form: ParsedForm,
  nProfiles: number,
  customInstructions: string,
  qConfig: QuestionConfigMap,
  language: string
): string {
  const lines: string[] = [
    `Formulario: "${form.title}"`,
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

  form.questions.forEach((q, idx) => {
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
}

/** Retorna perfiles como Record<entry, respuesta>, uno por respuesta a enviar. */
export async function generateProfiles(
  form: ParsedForm,
  opts: GenerateProfilesOptions
): Promise<Record<string, string>[]> {
  const qConfig = opts.qConfig ?? {};
  const language = opts.language ?? "español";
  const prompt = buildPrompt(form, opts.nProfiles, opts.customInstructions ?? "", qConfig, language);

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
    // corto y la respuesta llegaba truncada (JSON inválido).
    16000
  );

  const rawProfiles = cleanAndParseJson(text);

  return rawProfiles.map((raw) => {
    const r = raw as Record<string, unknown>;
    const profile: Record<string, string> = {};
    form.questions.forEach((q: ParsedQuestion, idx) => {
      const i = idx + 1;
      let answer = String(r[`P${i}`] ?? r[`p${i}`] ?? "").trim();
      if (q.options.length && !q.options.includes(answer)) {
        const match = q.options.find((opt) => opt.trim().toLowerCase() === answer.toLowerCase());
        answer = match ?? q.options[Math.floor(Math.random() * q.options.length)];
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
    // si la moderación no se puede interpretar, se rechaza por seguridad
  }
  return { allowed: false, reason: "No se pudo verificar el contenido del formulario." };
}
