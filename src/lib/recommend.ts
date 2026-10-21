/**
 * Recomendador de configuración por pregunta. Puerto de
 * app/core/ai_client.py (_heuristic_recommendations + recommend_form_config),
 * adaptado al servicio web: donde el bot de escritorio sugería "ai" (allí
 * cada usuario paga su propia API key), aquí se sugiere el modo local que
 * ya cubre dataGen.ts (nombre, correo, edad, DNI...) y se reserva "ai" para
 * preguntas abiertas de opinión, que es donde la IA realmente aporta.
 */
import type { ParsedForm, ParsedQuestion } from "./formParser";
import type { QuestionMode } from "./aiProfiles";
import { callGroqJson } from "./aiProfiles";

export type Recommendation = {
  mode: QuestionMode;
  value: string;
  prompt: string;
  badge: string;
  reason: string;
  /** true si el modo recomendado es "ai" (solo con créditos comprados). */
  requiresCredits: boolean;
  /** Alternativa sin IA para quien no tiene créditos comprados. */
  freeAlternative?: { mode: QuestionMode; value: string };
};

export type RecommendationMap = Record<string, Recommendation>;

function norm(t: string): string {
  return t.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").trim();
}

const OPEN_TEXT_FALLBACK =
  "Me pareció bien|Todo correcto|Muy buena experiencia|Podría mejorar un poco|Estoy conforme|Nada que agregar";

function rec(
  mode: QuestionMode,
  badge: string,
  reason: string,
  extra: Partial<Recommendation> = {}
): Recommendation {
  return { mode, value: "", prompt: "", badge, reason, requiresCredits: mode === "ai", ...extra };
}

function recommendOne(q: ParsedQuestion, isPeru: boolean): Recommendation {
  const t = norm(q.title);

  if (q.validation?.kind === "number") {
    const { min, max } = q.validation;
    const range = min !== undefined && max !== undefined ? `${min}-${max}` : "";
    return rec("fixed", "Número validado", "Tu formulario exige un número; se genera dentro del rango permitido.", {
      value: range,
    });
  }
  if (q.validation?.kind === "email") {
    return rec("random", "Correo válido", "Tu formulario valida el correo: se genera uno con formato correcto.");
  }

  if (q.options.length) return rec("random", "Aleatorio", "Tiene opciones: se elige una al azar en cada respuesta.");
  if (q.type === 5) return rec("random", "Escala", "Escala numérica: valor al azar dentro de la escala.");
  if (q.type === 9) return rec("random", "Fecha", "Fecha válida generada automáticamente.");
  if (q.type === 10) return rec("random", "Hora", "Hora válida generada automáticamente.");

  if (/\b(dni|documento|cedula|id number)\b/.test(t)) {
    return rec("fixed", "DNI (8 dígitos)", "Solo números de 8 dígitos para no fallar la validación.", {
      value: "10000000-79999999",
    });
  }
  if (/\bruc\b|\btax id\b|\bnit\b/.test(t)) {
    return rec("fixed", "RUC (11 dígitos)", "Solo 11 dígitos numéricos.", { value: "10000000000-20999999999" });
  }
  if (/\b(celular|telefono|phone|mobile|whatsapp|movil)\b/.test(t)) {
    return isPeru
      ? rec("fixed", "Celular (9 dígitos)", "Celular peruano de 9 dígitos que empieza en 9, solo números.", {
          value: "900000000-999999999",
        })
      : rec("random", "Teléfono", "Teléfono solo con dígitos.");
  }
  if (/\b(edad|age|cuantos anos)\b/.test(t)) {
    return rec("fixed", "Edad", "Edad como número entero; ajusta el rango a tu público.", { value: "18-45" });
  }
  if (/\b(correo|email|e-mail)\b/.test(t)) {
    return rec("random", "Correo", "Correo realista que coincide con el nombre generado.");
  }
  if (/\b(nombre|nombres|name|full name|apellidos?)\b/.test(t)) {
    return rec("random", "Nombre completo", "Nombre y dos apellidos distintos, sin repetir entre respuestas.");
  }
  if (/\b(ciudad|distrito|provincia|city|pais|country|ocupacion|profesion|carrera)\b/.test(t)) {
    return rec("random", "Dato automático", "Se genera desde una lista de valores realistas.");
  }
  if (
    /\b(opinion|comentario|sugerencia|feedback|experiencia|describa|describe|por que|why|motivo|razon|recomienda|expectativa|mensaje|explica)\b/.test(
      t
    ) ||
    q.type === 1
  ) {
    return rec("ai", "IA (pregunta abierta)", "Pregunta abierta: la IA escribe una opinión natural distinta en cada respuesta.", {
      prompt: "Escribe una opinión personal, natural y breve (1-2 oraciones) acorde al tema del formulario.",
      freeAlternative: { mode: "fixed", value: OPEN_TEXT_FALLBACK },
    });
  }
  return rec("random", "Automático", "Texto corto generado sin IA según el título de la pregunta.");
}

/** Recomendaciones offline (sin IA, gratis, para todos). */
export function heuristicRecommendations(form: Pick<ParsedForm, "title" | "description" | "questions">): RecommendationMap {
  // El servicio está orientado a Perú: celulares de 9 dígitos que empiezan en 9.
  const out: RecommendationMap = {};
  for (const q of form.questions) out[q.entry] = recommendOne(q, true);
  return out;
}

/**
 * Recomendaciones con IA (solo con créditos comprados): parte de la
 * heurística y deja que el modelo ajuste modo/prompt por pregunta. Ante
 * cualquier error devuelve la heurística — nunca falla.
 */
export async function aiRecommendations(
  form: Pick<ParsedForm, "title" | "description" | "questions">
): Promise<{ recommendations: RecommendationMap; source: "ai" | "heuristic" }> {
  const base = heuristicRecommendations(form);
  const lines = form.questions.slice(0, 60).map((q, i) => {
    const opts = q.options.length ? ` (opciones: ${q.options.slice(0, 8).join(", ")})` : " (texto libre)";
    return `${q.entry}: P${i + 1} "${q.title}"${opts}`;
  });
  const prompt = [
    `Formulario: "${form.title}"`,
    form.description ? `Descripción: "${form.description.slice(0, 400)}"` : "",
    "Preguntas:",
    ...lines,
    "",
    "Para cada pregunta decide cómo llenarla con datos de prueba realistas:",
    '- "random": se elige una opción o un dato realista automático (nombre, correo, edad, ciudad).',
    '- "fixed": valor fijo, lista separada por | o rango numérico como 18-65 (úsalo para números con formato: DNI, celular, edad).',
    '- "ai": solo para preguntas abiertas de opinión donde se necesita texto natural distinto en cada respuesta.',
    'Responde SOLO JSON: {"entry.123": {"mode": "random|fixed|ai", "value": "", "prompt": "instrucción breve si es ai", "reason": "motivo breve en español"}}',
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const data = await callGroqJson(prompt, 3000);
    if (data && typeof data === "object" && !Array.isArray(data)) {
      for (const [entry, val] of Object.entries(data as Record<string, unknown>)) {
        const cur = base[entry];
        if (!cur || !val || typeof val !== "object") continue;
        const v = val as Partial<Record<"mode" | "value" | "prompt" | "reason", unknown>>;
        const mode = v.mode === "ai" || v.mode === "fixed" || v.mode === "random" ? v.mode : cur.mode;
        base[entry] = {
          ...cur,
          mode,
          value: typeof v.value === "string" ? v.value.slice(0, 300) : cur.value,
          prompt: typeof v.prompt === "string" ? v.prompt.slice(0, 300) : cur.prompt,
          reason: typeof v.reason === "string" && v.reason.trim() ? v.reason.slice(0, 200) : cur.reason,
          requiresCredits: mode === "ai",
          freeAlternative: mode === "ai" ? cur.freeAlternative ?? { mode: "fixed", value: OPEN_TEXT_FALLBACK } : undefined,
        };
      }
      return { recommendations: base, source: "ai" };
    }
  } catch (e) {
    console.error("[recommend] IA no disponible, usando heurística:", e instanceof Error ? e.message : e);
  }
  return { recommendations: base, source: "heuristic" };
}
