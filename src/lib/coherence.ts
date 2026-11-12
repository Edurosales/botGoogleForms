/**
 * Coherencia dentro de cada respuesta, como la llenaría una persona real.
 *
 * Antes cada pregunta se generaba por separado y salían cosas sin sentido:
 * - Fecha de nacimiento 1973 y rango de edad "20 a 25 años".
 * - "Si marcaste Otro, detalla…" respondida aunque no se marcó "Otro"
 *   (o vacía cuando sí se marcó).
 *
 * Se corrige DESPUÉS de generar y ANTES de las secciones (formRoute):
 * - Edad: se elige una "edad ancla" por respuesta y la fecha/año de
 *   nacimiento, la edad y el rango de edad se ajustan a ella. Lo que el
 *   cliente fijó (Fijo, Porcentajes, Lista, sus datos) es el ancla y nunca
 *   se toca.
 * - Preguntas de seguimiento ("si marcaste Otro…", "especifica", "¿cuál?"):
 *   solo se responden si en la pregunta de la que dependen se marcó esa
 *   opción, y con algo del tipo que piden (una app, no un nombre de persona).
 *   Si el cliente puso sus propias condiciones en esa pregunta, mandan las suyas.
 */
import type { ParsedQuestion } from "./formParser";
import { normalize, satisfiesValidation, thingValue } from "./dataGen";

export type Locked = (entry: string) => boolean;

// ── Edad ─────────────────────────────────────────────────────────

type AgeKind = "birth" | "birthYear" | "age" | "range";

const BIRTH = /\b(nacimiento|naciste|nacio|birth|born|nascimento|nascita|naissance)\b/;
const AGE = /\b(edad|edades|age|idade|eta|cuantos anos tienes|cuantos anos tiene)\b/;
// "Edad de tu hijo", "edad de la empresa": no es la edad de quien responde.
const OTHER_AGE = /\bedad (?:de|del) (?:la |el |los |las |tu |su |sus |tus )?(?!encuestad|participante|entrevistad|usted|ti\b|la persona)/;

export function ageKind(q: ParsedQuestion): AgeKind | null {
  const t = normalize(q.title);
  if (BIRTH.test(t)) {
    if (OTHER_AGE.test(t) || /\b(hijo|hija|mascota|empresa)\b/.test(t)) return null;
    if (q.type === 9) return "birth";
    if (q.options.length) return null;
    if (/\b(ano|year|ano de nacimiento)\b/.test(t) && !/\bfecha\b/.test(t)) return "birthYear";
    return "birth";
  }
  if (!AGE.test(t) || OTHER_AGE.test(t)) return null;
  if (q.options.length) return q.options.some((o) => parseAgeOption(o)) ? "range" : null;
  if (q.type === 0 || q.type === 1) return "age";
  return null;
}

/** "18 - 24 años", "De 20 a 25", "Menos de 18", "60 a más", "65+", "30" → [mín, máx]. */
export function parseAgeOption(option: string): [number, number] | null {
  const t = normalize(option);
  const nums = (t.match(/\d{1,3}/g) ?? []).map(Number).filter((n) => n > 0 && n < 120);
  if (!nums.length) return null;
  if (nums.length >= 2) return [Math.min(nums[0], nums[1]), Math.max(nums[0], nums[1])];
  const n = nums[0];
  if (/\b(menos|menor|menores|under|below|hasta|o menos|less)\b|</.test(t)) return [Math.max(10, n - 6), /\bhasta\b|o menos/.test(t) ? n : n - 1];
  if (/\b(mas|mayor|mayores|over|above|more|o mas|a mas|plus)\b|\+|>/.test(t)) return [/\bmas de\b|\bmayor de\b|\bover\b|>/.test(t) ? n + 1 : n, n + 15];
  return [n, n];
}

const today = () => new Date();

function yearsBetween(from: Date, to: Date): number {
  let y = to.getUTCFullYear() - from.getUTCFullYear();
  const m = to.getUTCMonth() - from.getUTCMonth();
  if (m < 0 || (m === 0 && to.getUTCDate() < from.getUTCDate())) y--;
  return y;
}

/** Lee la fecha que haya generado el bot en cualquiera de sus formatos. */
function parseDate(v: string): Date | null {
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  return null;
}

function ageFrom(kind: AgeKind, q: ParsedQuestion, value: string): number | null {
  const v = value.trim();
  if (!v) return null;
  if (kind === "age") {
    const n = Number(v.match(/\d{1,3}/)?.[0]);
    return n > 0 && n < 120 ? n : null;
  }
  if (kind === "birthYear") {
    const y = Number(v.match(/\d{4}/)?.[0]);
    return y > 1900 ? today().getUTCFullYear() - y : null;
  }
  if (kind === "birth") {
    const d = parseDate(v);
    return d ? yearsBetween(d, today()) : null;
  }
  const opt = v.split("|")[0].trim();
  const r = parseAgeOption(opt);
  if (!r || !q.options.includes(opt)) return null;
  return r[0] + Math.floor(Math.random() * (r[1] - r[0] + 1));
}

function fitsAge(kind: AgeKind, q: ParsedQuestion, value: string, age: number): boolean {
  if (kind === "range") {
    const r = parseAgeOption(value.split("|")[0].trim());
    return !!r && age >= r[0] && age <= r[1];
  }
  const a = ageFrom(kind, q, value);
  // El año solo no dice si ya cumplió: vale con 1 año de diferencia.
  return a !== null && (kind === "birthYear" ? Math.abs(a - age) <= 1 : a === age);
}

/** Fecha de nacimiento al azar que da exactamente `age` años hoy. */
function birthDateFor(age: number): Date {
  const now = today();
  const latest = Date.UTC(now.getUTCFullYear() - age, now.getUTCMonth(), now.getUTCDate());
  const earliest = Date.UTC(now.getUTCFullYear() - age - 1, now.getUTCMonth(), now.getUTCDate()) + 86_400_000;
  return new Date(earliest + Math.floor(Math.random() * ((latest - earliest) / 86_400_000 + 1)) * 86_400_000);
}

function valueForAge(kind: AgeKind, q: ParsedQuestion, age: number, previous: string): string | null {
  if (kind === "age") return String(age);
  if (kind === "birthYear") return String(birthDateFor(age).getUTCFullYear());
  if (kind === "birth") {
    const d = birthDateFor(age);
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    // Se respeta el formato que ya tenía (texto "15/06/1995" o fecha ISO).
    if (q.type !== 9 && /^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}$/.test(previous.trim())) return `${dd}/${mm}/${d.getUTCFullYear()}`;
    return `${d.getUTCFullYear()}-${mm}-${dd}`;
  }
  const hits = q.options.filter((o) => {
    const r = parseAgeOption(o);
    return r && age >= r[0] && age <= r[1];
  });
  if (hits.length) return hits[Math.floor(Math.random() * hits.length)];
  // Ninguna opción la contiene: la más cercana.
  let best: string | null = null;
  let gap = Infinity;
  for (const o of q.options) {
    const r = parseAgeOption(o);
    if (!r) continue;
    const g = age < r[0] ? r[0] - age : age - r[1];
    if (g < gap) {
      gap = g;
      best = o;
    }
  }
  return best;
}

function fixAges(p: Record<string, string>, questions: ParsedQuestion[], locked: Locked): void {
  const ageQs = questions
    .map((q) => ({ q, kind: ageKind(q) }))
    .filter((x): x is { q: ParsedQuestion; kind: AgeKind } => !!x.kind && !!(p[x.q.entry] ?? "").trim());
  if (ageQs.length < 2) return;
  // Ancla: lo que el cliente fijó; si no, el rango de edad (sus opciones dicen
  // a quién va dirigido el formulario); si no, la primera del formulario.
  const order = [...ageQs].sort((a, b) => {
    const la = locked(a.q.entry) ? 0 : 1;
    const lb = locked(b.q.entry) ? 0 : 1;
    if (la !== lb) return la - lb;
    return (a.kind === "range" ? 0 : 1) - (b.kind === "range" ? 0 : 1);
  });
  let age: number | null = null;
  let anchor = "";
  for (const x of order) {
    age = ageFrom(x.kind, x.q, p[x.q.entry]);
    if (age !== null) {
      anchor = x.q.entry;
      break;
    }
  }
  if (age === null) return;
  for (const { q, kind } of ageQs) {
    if (q.entry === anchor || locked(q.entry)) continue;
    const current = p[q.entry];
    if (fitsAge(kind, q, current, age)) continue;
    const next = valueForAge(kind, q, age, current);
    // Si el formulario valida la edad (ej. 18 a 30) y no entra, se deja como estaba.
    if (next !== null && satisfiesValidation(q, next)) p[q.entry] = next;
  }
}

// ── Preguntas que dependen de otra ("si marcaste Otro…") ──────────

const OTHER_OPT = /^(otro|otra|otros|otras|other|others|outro|outra|outros|altro|altra|altri|autre|autres)\b/;
// Dice de qué opción depende: "si marcaste…", "en caso de haber elegido…".
const EXPLICIT =
  /\b(si (?:tu respuesta|la respuesta|tu respuesta anterior|usted|tu)? ?(?:fue|es|marcaste|marco|marca|elegiste|eligio|seleccionaste|selecciono|respondiste|respondio|escogiste|escogio|indicaste|indico|optaste|opto)\b|en caso (?:de )?(?:que )?(?:haya\w* )?(?:marc\w*|eleg\w*|elig\w*|seleccion\w*|respond\w*|escog\w*|opt\w*|ser |sea )|caso afirmativo|caso negativo|(?:if|when) you (?:chose|selected|answered|picked|marked|ticked))/;
// Pide detallar ("especifica", "¿cuál?", "otro: …") en un título corto.
const SHORT_ASK = /\b(especifi\w*|detall\w*|cual(?:es)?|which|specify|otro|otra|other)\b/;
const DETAIL = /\b(especifi\w*|detall\w*|cual(?:es)?|which|specify|indica\w*|menciona\w*|escrib\w*)\b/;
const MENTIONS_OTHER = /\b(otro|otra|otros|otras|other|others|outro|altro|autre)\b/;
const MENTIONS_YES = /\b(caso afirmativo|(?:respond|marc|eleg|elig|seleccion|escog|opt)\w* (?:con )?(?:que )?si|(?:respuesta|tu respuesta) (?:es|fue) (?:que )?si|answered yes|if yes)\b/;
const MENTIONS_NO = /\b(caso negativo|(?:respond|marc|eleg|elig|seleccion|escog|opt)\w* (?:con )?(?:que )?no|(?:respuesta|tu respuesta) (?:es|fue) (?:que )?no|answered no|if no|if not)\b/;
const YES_OPT = /^(si|yes|sim|oui)\b/;
const NO_OPT = /^(no|non|nao)\b/;

export type FollowUp = { entry: string; parent: string; trigger: string };

/** Detecta qué preguntas dependen de una opción de la anterior. */
export function detectFollowUps(questions: ParsedQuestion[]): FollowUp[] {
  const out: FollowUp[] = [];
  questions.forEach((q, i) => {
    if (i === 0 || q.options.length) return; // solo texto libre (lo típico: "especifica")
    const t = normalize(q.title);
    const words = t.split(/\s+/).filter(Boolean).length;
    // "¿Cuál es tu ciudad?" después de "Sexo (Otro)" NO depende de nada: un
    // "¿cuál?" o "especifica" suelto solo cuenta en títulos cortos.
    const explicit = EXPLICIT.test(t) || (MENTIONS_OTHER.test(t) && DETAIL.test(t));
    const shortAsk = (words <= 2 && SHORT_ASK.test(t)) || /^(especifi|detall|please specify|specify)/.test(t);
    if (!explicit && !shortAsk) return;
    // La pregunta de la que depende: la inmediatamente anterior, en la misma sección.
    const parent = questions[i - 1];
    if ((parent.section ?? 1) !== (q.section ?? 1)) return;
    if (!parent.options.length || parent.type === 5 || parent.type === 7 || parent.type === 13) return;
    const opts = parent.options.map((o) => ({ o, n: normalize(o).trim() }));
    let trigger: string | undefined;
    if (MENTIONS_NO.test(t)) trigger = opts.find((x) => NO_OPT.test(x.n))?.o;
    else if (MENTIONS_YES.test(t)) trigger = opts.find((x) => YES_OPT.test(x.n))?.o;
    if (!trigger) trigger = opts.find((x) => OTHER_OPT.test(x.n))?.o;
    if (trigger) out.push({ entry: q.entry, parent: parent.entry, trigger });
  });
  return out;
}

const NOT_APPLICABLE: Record<string, string> = {
  es: "No aplica",
  en: "N/A",
  pt: "Não se aplica",
  it: "Non applicabile",
  fr: "Sans objet",
};

function langCode(language: string): string {
  const l = normalize(language).trim();
  if (/^(ingles|english|en)/.test(l)) return "en";
  if (/^(portugues|pt)/.test(l)) return "pt";
  if (/^(italiano|it)/.test(l)) return "it";
  if (/^(frances|francais|fr)/.test(l)) return "fr";
  return "es";
}

function fixFollowUps(
  p: Record<string, string>,
  questions: ParsedQuestion[],
  follows: FollowUp[],
  locked: Locked,
  regenerable: (entry: string) => boolean,
  language: string
): void {
  const byEntry = new Map(questions.map((q) => [q.entry, q]));
  for (const f of follows) {
    if (locked(f.entry)) continue;
    const q = byEntry.get(f.entry);
    const parentQ = byEntry.get(f.parent);
    if (!q || !parentQ) continue;
    const chosen = (p[f.parent] ?? "").split("|").map((v) => v.trim());
    if (chosen.includes(f.trigger)) {
      // Sí la marcó: la respuesta debe decir QUÉ (una app, un motivo…), no un nombre de persona.
      if (regenerable(f.entry) || !(p[f.entry] ?? "").trim()) {
        const v = thingValue(q.title) ?? thingValue(parentQ.title);
        if (v && satisfiesValidation(q, v)) p[f.entry] = v;
      }
    } else if (q.required) {
      // Google obliga a responderla aunque no aplique: se dice que no aplica.
      const na = NOT_APPLICABLE[langCode(language)];
      p[f.entry] = satisfiesValidation(q, na) ? na : p[f.entry];
    } else {
      delete p[f.entry];
    }
  }
}

// ── Entrada ──────────────────────────────────────────────────────

export interface CoherenceOptions {
  /** Pregunta fijada por el cliente en esta respuesta (no se toca). */
  locked: (index: number, entry: string) => boolean;
  /** Pregunta con valor al azar del bot (se puede reemplazar por uno mejor). */
  regenerable: (entry: string) => boolean;
  /** Preguntas con condiciones puestas por el cliente: mandan las suyas. */
  hasUserRules: (entry: string) => boolean;
  language?: string;
}

export function applyCoherence(
  profiles: Record<string, string>[],
  questions: ParsedQuestion[],
  opts: CoherenceOptions
): Record<string, string>[] {
  const follows = detectFollowUps(questions).filter((f) => !opts.hasUserRules(f.entry));
  const hasAge = questions.filter((q) => ageKind(q)).length >= 2;
  if (!follows.length && !hasAge) return profiles;
  return profiles.map((profile, i) => {
    const p = { ...profile };
    const locked: Locked = (e) => opts.locked(i, e) || opts.hasUserRules(e);
    if (hasAge) fixAges(p, questions, locked);
    if (follows.length) fixFollowUps(p, questions, follows, locked, opts.regenerable, opts.language ?? "español");
    return p;
  });
}
