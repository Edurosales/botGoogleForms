/**
 * Recorrido por secciones, como lo haría una persona: se empieza en la
 * sección 1 y, si una pregunta de la sección "salta" según la respuesta
 * (ej. "No" → sección 4), se sigue a esa sección; si no, a la siguiente.
 *
 * Las preguntas de secciones que esa respuesta NO visita se dejan vacías y
 * a Google se le manda el camino real (pageHistory). Antes cada pregunta se
 * respondía por separado: salía "No" pero igual se llenaban las preguntas que
 * solo se abren con "Sí", y el resultado era inconsistente.
 */
import type { ParsedQuestion } from "./formParser";

/** Clave interna del perfil con el camino (no es una pregunta: no va al Excel). */
export const PAGE_HISTORY_KEY = "__pageHistory";

export function hasBranching(questions: ParsedQuestion[]): boolean {
  return questions.some((q) => q.jumps && Object.keys(q.jumps).length > 0);
}

export function routeProfile(profile: Record<string, string>, questions: ParsedQuestion[], numSections: number): Record<string, string> {
  if (!hasBranching(questions) || numSections <= 1) return profile;
  const visited: number[] = [];
  let s = 1;
  while (s >= 1 && s <= numSections && !visited.includes(s) && visited.length <= numSections) {
    visited.push(s);
    let next = s + 1;
    for (const q of questions) {
      if ((q.section ?? 1) !== s || !q.jumps) continue;
      const answer = (profile[q.entry] ?? "").split("|")[0]?.trim() ?? "";
      if (answer && q.jumps[answer]) next = q.jumps[answer];
    }
    s = next;
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(profile)) out[k] = v;
  for (const q of questions) {
    if (!visited.includes(q.section ?? 1)) delete out[q.entry];
  }
  out[PAGE_HISTORY_KEY] = visited.map((n) => n - 1).join(",");
  return out;
}
