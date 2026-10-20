/**
 * Descarga y parsea cualquier Google Form público.
 * Puerto 1:1 de app/core/form_parser.py (ver PROYECTO.md del bot de escritorio).
 * Maneja formularios de una o varias secciones (multi-page).
 */

export type QuestionType = 0 | 1 | 2 | 3 | 4 | 5 | 7 | 8 | 9 | 10 | 13 | number;

export interface ParsedQuestion {
  id: number;
  entry: string;
  title: string;
  type: QuestionType;
  typeName: string;
  options: string[];
  required: boolean;
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

export class FormParseError extends Error {}

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
    throw new FormParseError(
      "No se encontró el formulario en la página. Verifica que el link sea correcto y que el formulario sea público."
    );
  }

  const start = html.indexOf("[", idx);
  if (start === -1) {
    throw new FormParseError("No se pudo parsear el formulario.");
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
    throw new FormParseError(`Error parseando datos del formulario: ${(e as Error).message}`);
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

      let required = false;
      for (const reqIdx of [6, 5]) {
        const v = item[reqIdx];
        if ((typeof v === "boolean" || typeof v === "number") && !Array.isArray(v)) {
          required = Boolean(v);
          break;
        }
      }

      questions.push({
        id: entryId,
        entry: `entry.${entryId}`,
        title: qTitle.trim(),
        type: Math.max(0, itemType),
        typeName: QUESTION_TYPES[Math.max(0, itemType)] ?? `Tipo ${itemType}`,
        options,
        required,
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
  let { viewUrl, submitUrl } = normalizeUrls(inputUrl);

  const resp = await fetch(viewUrl, { headers: BROWSER_HEADERS, redirect: "follow" });
  if (!resp.ok) {
    throw new FormParseError(`No se pudo descargar el formulario (HTTP ${resp.status}).`);
  }

  // Si hubo redirección (ej. enlace acortado forms.gle), actualizar view/submit URL
  if (resp.url && resp.url !== viewUrl) {
    const norm = normalizeUrls(resp.url);
    viewUrl = norm.viewUrl;
    submitUrl = norm.submitUrl;
  }

  const html = await resp.text();

  // Extraer submit_url real desde el action= del formulario
  const actionM = html.match(/<form[^>]+action="([^"]*formResponse[^"]*)"/);
  if (actionM) {
    const rawAction = actionM[1].replace(/&amp;/g, "&").split("?")[0];
    submitUrl = new URL(rawAction, resp.url || viewUrl).toString();
  }

  const raw = extractRawJson(html);
  const formBody = (raw as unknown[])[1] as unknown[] | undefined;

  let title = "";
  for (const idx of [8, 0]) {
    const v = formBody?.[idx];
    if (typeof v === "string" && v.trim()) {
      title = v.trim();
      break;
    }
  }

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
    throw new FormParseError(
      "No se encontraron preguntas. Asegúrate de que el formulario sea público y tenga preguntas visibles."
    );
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
    throw new FormParseError(
      "No se encontraron preguntas en el formulario. El formulario puede estar vacío, ser privado o tener una estructura no reconocida."
    );
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
