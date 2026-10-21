/**
 * Descarga y parsea cualquier Google Form público.
 * Puerto 1:1 de app/core/form_parser.py (ver PROYECTO.md del bot de escritorio).
 * Maneja formularios de una o varias secciones (multi-page).
 */

export type QuestionType = 0 | 1 | 2 | 3 | 4 | 5 | 7 | 8 | 9 | 10 | 13 | number;

/**
 * Regla de validación que el dueño puso en Google Forms (si se pudo leer).
 * Se usa para generar valores locales que la pasen y para explicar fallos.
 */
export type QuestionValidation =
  | { kind: "number"; min?: number; max?: number; integer?: boolean; message?: string }
  | { kind: "email"; message?: string }
  | { kind: "url"; message?: string }
  | { kind: "length"; min?: number; max?: number; message?: string }
  | { kind: "regex"; pattern: string; message?: string }
  | { kind: "contains"; text: string; negate?: boolean; message?: string };

export interface ParsedQuestion {
  id: number;
  entry: string;
  title: string;
  type: QuestionType;
  typeName: string;
  options: string[];
  required: boolean;
  validation?: QuestionValidation;
}

export interface ParsedForm {
  title: string;
  description: string;
  questions: ParsedQuestion[];
  viewUrl: string;
  submitUrl: string;
  numSections: number;
  collectsEmail: boolean;
}

export const QUESTION_TYPES: Record<number, string> = {
  0: "Texto corto",
  1: "Párrafo",
  2: "Opción múltiple",
  3: "Lista desplegable",
  4: "Casillas",
  5: "Escala lineal",
  7: "Cuadrícula",
  8: "Sección",
  9: "Fecha",
  10: "Hora",
  13: "Cuadrícula de casillas",
};

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
  Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
};

export type FormErrorCode =
  | "INVALID_URL"
  | "NOT_GOOGLE_FORM"
  | "NOT_PUBLIC"
  | "CLOSED"
  | "NOT_FOUND"
  | "COLLECTS_EMAIL"
  | "FILE_UPLOAD"
  | "NO_QUESTIONS"
  | "FETCH_FAILED";

export class FormParseError extends Error {
  code: FormErrorCode;
  constructor(message: string, code: FormErrorCode = "FETCH_FAILED") {
    super(message);
    this.code = code;
  }
}

export const FORM_ERROR_MESSAGES: Record<FormErrorCode, string> = {
  INVALID_URL:
    'Eso no parece un link válido. Copia el link desde el botón "Enviar" de tu Google Form (ícono de cadena) y pégalo aquí.',
  NOT_GOOGLE_FORM:
    'Solo funciona con links de Google Forms (docs.google.com/forms/... o forms.gle/...). Copia el link desde el botón "Enviar" de tu formulario.',
  NOT_PUBLIC:
    'Tu formulario pide iniciar sesión con Google para responder, así que no es público. En Google Forms ve a Configuración → Respuestas y desactiva "Restringir a usuarios de tu organización" y "Limitar a 1 respuesta". Si tiene una pregunta de subir archivo, quítala: obliga a iniciar sesión.',
  CLOSED:
    'Tu formulario no está aceptando respuestas. En Google Forms abre la pestaña Respuestas y activa "Se aceptan respuestas".',
  NOT_FOUND:
    'No encontramos ese formulario. Puede que se haya borrado o que el link esté incompleto: cópialo de nuevo desde el botón "Enviar".',
  COLLECTS_EMAIL:
    'Tu formulario recolecta correos verificados, y eso exige que cada persona inicie sesión con su cuenta de Google — no se puede simular. En Google Forms ve a Configuración → Respuestas → Recopilar direcciones de correo electrónico y elige "No recopilar" (o "Respuesta del usuario").',
  FILE_UPLOAD:
    "Tu formulario tiene una pregunta de subir archivo. Google obliga a iniciar sesión para responderla, así que no se puede llenar automáticamente. Quita esa pregunta o pásala a otro formulario.",
  NO_QUESTIONS:
    "No encontramos preguntas en el formulario. Revisa que tenga preguntas visibles y que esté publicado.",
  FETCH_FAILED: "No pudimos abrir el formulario en este momento. Revisa el link e inténtalo de nuevo en un minuto.",
};

function fail(code: FormErrorCode, detail?: string): never {
  throw new FormParseError(detail ?? FORM_ERROR_MESSAGES[code], code);
}

const ALLOWED_HOSTS = new Set(["docs.google.com", "forms.gle", "forms.google.com"]);

/**
 * El servidor hace fetch() del link que cualquier visitante escribe en el
 * formulario — sin esta validación sería SSRF: alguien podría poner una
 * URL interna (ej. metadata de la nube, localhost, otro servicio de la
 * red) y el servidor la pediría por él. Solo se permiten los dominios
 * reales de Google Forms.
 */
function assertAllowedFormHost(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    fail("INVALID_URL");
  }
  if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) {
    fail("NOT_GOOGLE_FORM");
  }
}

function isLoginRedirect(url: URL): boolean {
  return url.hostname.toLowerCase() === "accounts.google.com" || /servicelogin|\/signin\b/i.test(url.pathname);
}

/**
 * Sigue redirecciones a mano validando CADA salto: con redirect:"follow"
 * el fetch ya se habría hecho antes de poder revisar el host (SSRF vía
 * redirección), y una redirección a accounts.google.com terminaría en un
 * error engañoso en vez de "tu formulario no es público".
 */
async function fetchFormPage(startUrl: string): Promise<{ html: string; finalUrl: string }> {
  let current = startUrl;
  for (let hop = 0; hop < 6; hop++) {
    assertAllowedFormHost(current);
    let resp: Response;
    try {
      resp = await fetch(current, { headers: BROWSER_HEADERS, redirect: "manual", cache: "no-store" });
    } catch {
      fail("FETCH_FAILED");
    }

    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get("location");
      if (!loc) fail("FETCH_FAILED");
      const next = new URL(loc, current);
      if (isLoginRedirect(next)) fail("NOT_PUBLIC");
      if (/\/closedform\b/.test(next.pathname)) fail("CLOSED");
      current = next.toString();
      continue;
    }

    if (resp.status === 404 || resp.status === 410) fail("NOT_FOUND");
    if (resp.status === 401 || resp.status === 403) fail("NOT_PUBLIC");
    if (!resp.ok) {
      fail("FETCH_FAILED", `No pudimos abrir el formulario (Google respondió ${resp.status}). Revisa el link e inténtalo de nuevo.`);
    }

    const html = await resp.text();
    if (/\/closedform\b/.test(new URL(current).pathname)) fail("CLOSED");
    return { html, finalUrl: current };
  }
  fail("FETCH_FAILED", "El link redirige demasiadas veces. Copia el link directo del formulario.");
}

function looksClosed(html: string): boolean {
  const h = html.toLowerCase();
  return (
    h.includes("ya no acepta respuestas") ||
    h.includes("no longer accepting responses") ||
    h.includes("is no longer accepting")
  );
}

function looksLikeLoginPage(html: string): boolean {
  const h = html.toLowerCase();
  return h.includes("accounts.google.com/servicelogin") && !h.includes("fb_public_load_data_");
}

// ── URL helpers ──────────────────────────────────────────────────

export function normalizeUrls(rawUrl: string): { viewUrl: string; submitUrl: string } {
  const url = rawUrl.trim();

  let m = url.match(/forms\/(?:u\/\d+\/)?d\/e\/([^/?#\s]+)/);
  if (m) {
    const fid = m[1];
    const uM = url.match(/forms\/u\/(\d+)\/d\/e\//);
    const prefix = uM ? `u/${uM[1]}/` : "";
    const base = `https://docs.google.com/forms/${prefix}d/e/${fid}/`;
    return { viewUrl: base + "viewform", submitUrl: base + "formResponse" };
  }

  m = url.match(/forms\/(?:u\/\d+\/)?d\/([^/?#\s]+)/);
  if (m) {
    const fid = m[1];
    const base = `https://docs.google.com/forms/d/${fid}/`;
    return { viewUrl: base + "viewform", submitUrl: base + "formResponse" };
  }

  if (url.includes("formResponse")) {
    const view = url.replace("formResponse", "viewform").split("?")[0];
    return { viewUrl: view, submitUrl: url.split("?")[0] };
  }

  return { viewUrl: url, submitUrl: url.replace(/\/+$/, "") + "/formResponse" };
}

// ── JSON extraction (FB_PUBLIC_LOAD_DATA_) ───────────────────────

function extractRawJson(html: string): unknown {
  const patterns = [
    /var FB_PUBLIC_LOAD_DATA_\s*=\s*(\[[\s\S]*?\]);\s*<\/script>/,
    /FB_PUBLIC_LOAD_DATA_\s*=\s*(\[[\s\S]*?\]);\s*<\/script>/,
  ];
  for (const pat of patterns) {
    const m = html.match(pat);
    if (m) {
      try {
        return JSON.parse(m[1]);
      } catch {
        // sigue al fallback de escaneo por balance de corchetes
      }
    }
  }

  const idx = html.indexOf("FB_PUBLIC_LOAD_DATA_");
  if (idx === -1) {
    fail(
      "NOT_PUBLIC",
      "No pudimos leer las preguntas de esa página. Revisa que sea el link para RESPONDER el formulario (no el de edición) y que el formulario sea público."
    );
  }

  const start = html.indexOf("[", idx);
  if (start === -1) {
    fail("FETCH_FAILED");
  }

  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = start;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === "\\" && inStr) {
      esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  try {
    return JSON.parse(html.slice(start, end + 1));
  } catch (e) {
    fail("FETCH_FAILED", `No pudimos interpretar el formulario (${(e as Error).message}).`);
  }
}

// ── Helper: detectar recolección de email desde el JSON raw ─────

/**
 * NOTA (2026-10-20): había aquí una comprobación adicional basada en
 * `raw[1][10][6] === 1`. Verificado con formularios reales que NO
 * recolectan email y aun así tienen esa posición en 1 — es un falso
 * positivo (esa posición no corresponde a la recolección de email). Se
 * removió; la detección confiable queda en las búsquedas de texto de
 * parseForm() (p.ej. `type="email"` en el HTML renderizado). Mismo
 * ajuste aplicado en app/core/form_parser.py del bot de escritorio.
 */
function jsonCollectsEmail(raw: unknown): boolean {
  try {
    if (JSON.stringify(raw).toLowerCase().includes("emailaddress")) return true;
  } catch {
    // ignore
  }
  return false;
}

// ── Parsers de estructura (hay dos variantes en Google Forms) ───

function firstString(opt: unknown[]): string {
  for (const v of opt) {
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}

// ── Validación de respuestas (best-effort) ──────────────────────
// En FB_PUBLIC_LOAD_DATA_ la validación de una pregunta vive en
// qField[4] = [[tipo, operador, [args], "mensaje de error"]].
// Códigos según ingeniería inversa de la comunidad (Google no lo
// documenta); si no calza con nada conocido se ignora en silencio.
//   tipo 1 = Número   op: 1 >, 2 >=, 3 <, 4 <=, 5 =, 7 entre, 10 entero
//   tipo 2 = Texto    op: 100 contiene, 101 no contiene, 102 email, 103 URL
//   tipo 4 = Regex    op: 299 contiene, 301 coincide
//   tipo 6 = Longitud op: 202 máximo, 203 mínimo

function num(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function parseValidation(qField: unknown[]): QuestionValidation | undefined {
  const block = qField[4];
  if (!Array.isArray(block) || !Array.isArray(block[0])) return undefined;
  const rule = block[0] as unknown[];
  const type = num(rule[0]);
  const op = num(rule[1]);
  const args = Array.isArray(rule[2]) ? (rule[2] as unknown[]) : [];
  const message = typeof rule[3] === "string" && rule[3].trim() ? rule[3].trim() : undefined;
  const a0 = num(args[0]);
  const a1 = num(args[1]);

  if (type === 1) {
    switch (op) {
      case 1: return { kind: "number", min: a0 !== undefined ? a0 + 1 : undefined, integer: true, message };
      case 2: return { kind: "number", min: a0, message };
      case 3: return { kind: "number", max: a0 !== undefined ? a0 - 1 : undefined, integer: true, message };
      case 4: return { kind: "number", max: a0, message };
      case 5: return { kind: "number", min: a0, max: a0, message };
      case 7: return { kind: "number", min: a0, max: a1, message };
      case 10: return { kind: "number", integer: true, message };
      default: return { kind: "number", message };
    }
  }
  if (type === 2) {
    if (op === 102) return { kind: "email", message };
    if (op === 103) return { kind: "url", message };
    const text = typeof args[0] === "string" ? args[0] : "";
    if (text && (op === 100 || op === 101)) return { kind: "contains", text, negate: op === 101, message };
  }
  if (type === 4 && (op === 301 || op === 299) && typeof args[0] === "string") {
    return { kind: "regex", pattern: args[0], message };
  }
  if (type === 6) {
    if (op === 202) return { kind: "length", max: a0, message };
    if (op === 203) return { kind: "length", min: a0, message };
  }
  return undefined;
}

/**
 * Pregunta de "subir archivo": en el JSON de Google es tipo 13 sin opciones
 * (la cuadrícula de casillas, que este parser también etiqueta 13, siempre
 * trae sus columnas como opciones). Normalmente Google ya redirige al login
 * antes de llegar aquí, pero por si la página se sirve igual.
 */
function isFileUploadItem(item: unknown[]): boolean {
  const qFields = Array.isArray(item[4]) ? (item[4] as unknown[]) : [];
  if (!qFields.length) return true;
  return qFields.every((qf) => !Array.isArray(qf) || !Array.isArray(qf[1]) || (qf[1] as unknown[]).length === 0);
}

function parseFlat(items: unknown[]): { questions: ParsedQuestion[]; numSections: number } {
  const questions: ParsedQuestion[] = [];
  let numSections = 0;

  for (const item of items) {
    if (!Array.isArray(item) || item.length < 4) continue;

    const itemType = typeof item[3] === "number" ? item[3] : -1;
    const itemTitle = typeof item[1] === "string" ? item[1] : "";

    if (itemType === 8) {
      numSections++;
      continue;
    }
    if (itemType === 13 && isFileUploadItem(item)) fail("FILE_UPLOAD");
    if (!itemTitle.trim()) continue;

    const qFields = Array.isArray(item[4]) ? (item[4] as unknown[]) : [];

    for (const qField of qFields) {
      if (!Array.isArray(qField) || qField.length === 0) continue;

      const entryId = qField[0];
      if (typeof entryId !== "number" || entryId === 0) continue;

      const options: string[] = [];
      for (const optIdx of [1, 2]) {
        if (Array.isArray(qField[optIdx])) {
          for (const opt of qField[optIdx] as unknown[]) {
            if (Array.isArray(opt) && opt.length) {
              let text = firstString(opt);
              if (!text && itemType === 5) {
                const numVal = opt.find((v) => typeof v === "number" && v > 0 && v <= 100);
                if (numVal !== undefined) text = String(numVal);
              }
              if (text) options.push(text);
            }
          }
          if (options.length) break;
        }
      }

      let qTitle = itemTitle;
      if (itemType === 7 || itemType === 13) {
        for (let pos = 2; pos < Math.min(qField.length, 7); pos++) {
          const v = qField[pos];
          if (typeof v === "string" && v.trim()) {
            qTitle = `${itemTitle} — ${v.trim()}`;
            break;
          }
        }
      }

      // Obligatoria = qField[2] (verificado en vivo: [entryId, opciones, 1]).
      const required = qField[2] === 1 || qField[2] === true;

      const validation = parseValidation(qField);
      questions.push({
        id: entryId,
        entry: `entry.${entryId}`,
        title: qTitle.trim(),
        type: Math.max(0, itemType),
        typeName: QUESTION_TYPES[Math.max(0, itemType)] ?? `Tipo ${itemType}`,
        options,
        required,
        ...(validation ? { validation } : {}),
      });
    }
  }

  return { questions, numSections: numSections + 1 };
}

function parseGrouped(groups: unknown[]): { questions: ParsedQuestion[]; numSections: number } {
  const questions: ParsedQuestion[] = [];
  let numSections = 0;

  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    numSections++;

    const sectionQs = group[0];
    if (!Array.isArray(sectionQs)) continue;

    for (const q of sectionQs) {
      if (!Array.isArray(q) || q.length < 2) continue;

      const entryId = q[0];
      const qTitle = q[1];
      if (typeof entryId !== "number" || entryId === 0) continue;
      if (typeof qTitle !== "string" || !qTitle.trim()) continue;

      const qType = typeof q[3] === "number" ? q[3] : 0;

      const options: string[] = [];
      if (Array.isArray(q[4])) {
        for (const opt of q[4] as unknown[]) {
          if (Array.isArray(opt) && opt.length && typeof opt[0] === "string") {
            options.push(opt[0]);
          }
        }
      }

      const required =
        (typeof q[5] === "boolean" || typeof q[5] === "number") ? Boolean(q[5]) : false;

      questions.push({
        id: entryId,
        entry: `entry.${entryId}`,
        title: qTitle.trim(),
        type: qType,
        typeName: QUESTION_TYPES[qType] ?? `Tipo ${qType}`,
        options,
        required,
      });
    }
  }

  return { questions, numSections: Math.max(1, numSections) };
}

// ── Parser principal ─────────────────────────────────────────────

export async function parseForm(inputUrl: string): Promise<ParsedForm> {
  const input = inputUrl.trim();
  if (!input) fail("INVALID_URL");
  let { viewUrl, submitUrl } = normalizeUrls(input);

  const { html, finalUrl } = await fetchFormPage(viewUrl);
  if (finalUrl !== viewUrl) {
    const norm = normalizeUrls(finalUrl);
    viewUrl = norm.viewUrl;
    submitUrl = norm.submitUrl;
    assertAllowedFormHost(viewUrl);
  }

  if (looksLikeLoginPage(html)) fail("NOT_PUBLIC");
  if (looksClosed(html)) fail("CLOSED");

  // Extraer submit_url real desde el action= del formulario
  const actionM = html.match(/<form[^>]+action="([^"]*formResponse[^"]*)"/);
  if (actionM) {
    const rawAction = actionM[1].replace(/&amp;/g, "&").split("?")[0];
    submitUrl = new URL(rawAction, finalUrl).toString();
    assertAllowedFormHost(submitUrl);
  }

  const raw = extractRawJson(html);
  const formBody = (raw as unknown[])[1] as unknown[] | undefined;

  let title = "";
  // raw[1][8] = título visible; raw[3] = nombre del archivo del formulario.
  // raw[1][0] es la DESCRIPCIÓN — solo como último recurso.
  for (const v of [formBody?.[8], (raw as unknown[])[3], formBody?.[0]]) {
    if (typeof v === "string" && v.trim()) {
      title = v.trim();
      break;
    }
  }
  if (title.length > 200) title = `${title.slice(0, 197)}…`;

  let description = "";
  const d = formBody?.[0];
  if (typeof d === "string" && d !== title) description = d;

  const htmlLower = html.toLowerCase();
  const collectsEmail =
    htmlLower.includes('"emailaddress"') ||
    htmlLower.includes("entry.emailaddress") ||
    htmlLower.includes("requireslogin") ||
    htmlLower.includes('"collect_email"') ||
    htmlLower.includes("collectemail") ||
    htmlLower.includes("requireemail") ||
    htmlLower.includes("loginemail") ||
    html.includes('type="email"') ||
    html.includes("type='email'") ||
    jsonCollectsEmail(raw);

  const items = formBody?.[1];
  if (!Array.isArray(items) || items.length === 0) {
    fail("NO_QUESTIONS");
  }

  const firstValid = items.find((x) => Array.isArray(x) && x.length);
  let questions: ParsedQuestion[] = [];
  let numSections = 1;

  if (firstValid !== undefined) {
    if (Array.isArray((firstValid as unknown[])[0])) {
      ({ questions, numSections } = parseGrouped(items));
      if (!questions.length) ({ questions, numSections } = parseFlat(items));
    } else {
      ({ questions, numSections } = parseFlat(items));
      if (!questions.length) ({ questions, numSections } = parseGrouped(items));
    }
  }

  if (!questions.length) {
    fail("NO_QUESTIONS");
  }

  return {
    title,
    description,
    questions,
    viewUrl,
    submitUrl,
    numSections,
    collectsEmail,
  };
}
