/**
 * "Usar mis datos": leer una tabla (CSV, Excel .xlsx o Google Sheets) y
 * convertir cada fila en una respuesta del formulario. Todo se lee en el
 * navegador (sin librerías externas); el servidor vuelve a validar las filas.
 *
 * Formato de cada respuesta igual que el resto del servicio:
 * casillas "A|B", fecha "AAAA-MM-DD", hora "HH:MM".
 */
export type Table = { headers: string[]; rows: string[][] };
export type ImportQuestion = { entry: string; title: string; type: number; options: string[] };
export type Mapping = Record<string, number>; // entry → índice de columna (-1 = sin columna)
export type CellIssue = { row: number; value: string };

/** Filas máximas que se usan (una por respuesta; el servicio envía hasta 500). */
export const MAX_DATA_ROWS = 500;
export const MAX_CELL_CHARS = 1000;

// ── CSV ──────────────────────────────────────────────────────────────

/** CSV con comillas, saltos de línea dentro de comillas y separador , ; o tabulación. */
export function parseCsv(text: string): Table {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const);
  const delim = counts.sort((a, b) => b[1] - a[1])[0][0];
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      out.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    out.push(row);
  }
  return toTable(out);
}

function toTable(grid: string[][]): Table {
  const nonEmpty = grid.filter((r) => r.some((c) => c.trim() !== ""));
  const headers = (nonEmpty[0] ?? []).map((h) => h.trim());
  const rows = nonEmpty.slice(1).map((r) => headers.map((_, i) => (r[i] ?? "").trim().slice(0, MAX_CELL_CHARS)));
  return { headers, rows };
}

// ── Excel (.xlsx) ────────────────────────────────────────────────────

/** Lee la primera hoja de un .xlsx (zip + XML) con las APIs del navegador. */
export async function readXlsx(buf: ArrayBuffer): Promise<Table> {
  const files = await unzip(buf, (name) => name === "xl/sharedStrings.xml" || name === "xl/workbook.xml" || name === "xl/_rels/workbook.xml.rels" || /^xl\/worksheets\/[^/]+\.xml$/.test(name));
  const xml = (name: string) => (files.has(name) ? new DOMParser().parseFromString(files.get(name) as string, "application/xml") : null);

  const shared: string[] = [];
  const ss = xml("xl/sharedStrings.xml");
  if (ss) for (const si of Array.from(ss.getElementsByTagName("si"))) shared.push(Array.from(si.getElementsByTagName("t")).map((t) => t.textContent ?? "").join(""));

  // Primera hoja según el libro (si no, sheet1.xml).
  let sheetPath = "xl/worksheets/sheet1.xml";
  const wb = xml("xl/workbook.xml");
  const rels = xml("xl/_rels/workbook.xml.rels");
  const first = wb?.getElementsByTagName("sheet")[0];
  const rid = first?.getAttribute("r:id") ?? first?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
  if (rid && rels) {
    const rel = Array.from(rels.getElementsByTagName("Relationship")).find((r) => r.getAttribute("Id") === rid);
    const target = rel?.getAttribute("Target") ?? "";
    if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  }
  if (!files.has(sheetPath)) sheetPath = [...files.keys()].filter((k) => k.startsWith("xl/worksheets/")).sort()[0] ?? "";
  const sheet = sheetPath ? xml(sheetPath) : null;
  if (!sheet) throw new Error("No se encontró ninguna hoja en el archivo.");

  const grid: string[][] = [];
  for (const r of Array.from(sheet.getElementsByTagName("row"))) {
    const cells: string[] = [];
    let next = 0;
    for (const c of Array.from(r.getElementsByTagName("c"))) {
      const ref = c.getAttribute("r") ?? "";
      const col = ref ? colIndex(ref) : next;
      const t = c.getAttribute("t");
      let v = "";
      if (t === "inlineStr") v = Array.from(c.getElementsByTagName("t")).map((x) => x.textContent ?? "").join("");
      else {
        const raw = c.getElementsByTagName("v")[0]?.textContent ?? "";
        v = t === "s" ? (shared[Number(raw)] ?? "") : t === "b" ? (raw === "1" ? "TRUE" : "FALSE") : raw;
      }
      cells[col] = v;
      next = col + 1;
    }
    grid.push(Array.from(cells, (x) => x ?? ""));
  }
  return toTable(grid);
}

function colIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Zip mínimo: directorio central + inflate con DecompressionStream. */
async function unzip(buf: ArrayBuffer, want: (name: string) => boolean): Promise<Map<string, string>> {
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66_000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("El archivo no es un Excel válido (.xlsx).");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out = new Map<string, string>();
  for (let k = 0; k < count && p + 46 <= buf.byteLength; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!want(name)) continue;
    if (size > 30_000_000) throw new Error("El archivo es demasiado grande.");
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = new Uint8Array(buf, start, size);
    if (method === 0) out.set(name, dec.decode(data));
    else if (method === 8) {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      out.set(name, await new Response(stream).text());
    }
  }
  return out;
}

// ── Columnas → preguntas ─────────────────────────────────────────────

export function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.85;
  const wa = new Set(a.split(" "));
  const wb = new Set(b.split(" "));
  const inter = [...wa].filter((w) => wb.has(w)).length;
  return inter / Math.max(wa.size, wb.size);
}

/** Cada pregunta toma la columna cuyo encabezado más se parece a su título (sin repetir). */
export function autoMap(headers: string[], questions: ImportQuestion[]): Mapping {
  const used = new Set<number>();
  const map: Mapping = {};
  const hs = headers.map(norm);
  for (const q of questions) {
    const t = norm(q.title);
    let best = -1;
    let score = 0.5;
    hs.forEach((h, i) => {
      if (used.has(i)) return;
      const s = similarity(t, h);
      if (s > score) {
        score = s;
        best = i;
      }
    });
    map[q.entry] = best;
    if (best >= 0) used.add(best);
  }
  return map;
}

// ── Celdas → valores del formulario ──────────────────────────────────

function matchOption(q: ImportQuestion, v: string): string | null {
  const n = norm(v);
  return q.options.find((o) => o === v) ?? q.options.find((o) => norm(o) === n) ?? null;
}

/** Fecha a AAAA-MM-DD: acepta AAAA-MM-DD, DD/MM/AAAA, DD-MM-AAAA y número de serie de Excel. */
function toDate(v: string): string | null {
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  if (/^\d{4,5}(\.\d+)?$/.test(v)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(v)) * 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

/** Hora a HH:MM: acepta HH:MM(:SS), h:mm AM/PM y fracción de día de Excel. */
function toTime(v: string): string | null {
  const m = v.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap])?\.?\s*m?\.?$/i);
  if (m) {
    let h = Number(m[1]);
    if (m[3]) h = (h % 12) + (m[3].toLowerCase() === "p" ? 12 : 0);
    return h < 24 ? `${String(h).padStart(2, "0")}:${m[2]}` : null;
  }
  if (/^0?\.\d+$/.test(v)) {
    const mins = Math.round(Number(v) * 1440);
    return `${String(Math.floor(mins / 60) % 24).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  }
  return null;
}

/** Valor listo para enviar, o `ok: false` si no coincide con lo que la pregunta acepta. */
export function cellValue(q: ImportQuestion, raw: string): { value: string; ok: boolean } {
  const v = raw.trim();
  if (!v) return { value: "", ok: true };
  if (q.type === 9) {
    const d = toDate(v);
    return d ? { value: d, ok: true } : { value: v, ok: false };
  }
  if (q.type === 10) {
    const t = toTime(v);
    return t ? { value: t, ok: true } : { value: v, ok: false };
  }
  if (q.type === 4 || q.type === 13) {
    // Casillas: "A|B", "A; B" o "A, B" (así exporta Google sus respuestas).
    const parts = v.split(/\s*[|;]\s*/).length > 1 ? v.split(/\s*[|;]\s*/) : v.split(/\s*,\s*/);
    const matched = parts.map((p) => matchOption(q, p));
    if (matched.every(Boolean)) return { value: (matched as string[]).join("|"), ok: true };
    const whole = matchOption(q, v);
    return whole ? { value: whole, ok: true } : { value: parts.join("|"), ok: false };
  }
  if (q.options.length) {
    const o = matchOption(q, v);
    return o ? { value: o, ok: true } : { value: v, ok: false };
  }
  return { value: v, ok: true };
}

/**
 * Filas listas para el envío (solo las preguntas con columna) y, por pregunta,
 * las celdas que no coinciden con sus opciones o formato.
 */
export function buildRows(table: Table, mapping: Mapping, questions: ImportQuestion[]) {
  const rows: Record<string, string>[] = [];
  const issues: Record<string, CellIssue[]> = {};
  table.rows.slice(0, MAX_DATA_ROWS).forEach((r, i) => {
    const out: Record<string, string> = {};
    for (const q of questions) {
      const col = mapping[q.entry] ?? -1;
      if (col < 0) continue;
      const { value, ok } = cellValue(q, r[col] ?? "");
      if (value) out[q.entry] = value.slice(0, MAX_CELL_CHARS);
      if (!ok) (issues[q.entry] ??= []).push({ row: i + 2, value });
    }
    rows.push(out);
  });
  return { rows, issues };
}
