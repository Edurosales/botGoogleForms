"use client";

import { useMemo, useRef, useState } from "react";
import { autoMap, buildRows, MAX_DATA_ROWS, parseCsv, readXlsx, type ImportQuestion, type Mapping, type Table } from "@/lib/tableImport";
import { useLang } from "./LangProvider";

export type DataSet = { rows: Record<string, string>[]; mapping: Mapping; headers: string[] };

/**
 * "Usar mis datos": Excel, CSV o Google Sheets → una respuesta por fila.
 * Cada pregunta toma una columna (se asocian solas por título y se pueden
 * cambiar). Lo que no tiene columna sigue la configuración de la pregunta.
 */
export default function DataImport({
  questions,
  onChange,
  allowed,
  onBuy,
}: {
  questions: ImportQuestion[];
  onChange: (d: DataSet | null) => void;
  /** Solo con créditos comprados o regalados (el servidor también lo exige). */
  allowed: boolean;
  onBuy: () => void;
}) {
  const { tr } = useLang();
  const [table, setTable] = useState<Table | null>(null);
  const [source, setSource] = useState("");
  const [mapping, setMapping] = useState<Mapping>({});
  const [sheetUrl, setSheetUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const built = useMemo(() => (table ? buildRows(table, mapping, questions) : null), [table, mapping, questions]);

  function applyTable(t: Table, name: string) {
    if (!t.headers.length || !t.rows.length) {
      setError(tr("No encontramos filas: la primera fila debe tener los títulos y debajo una respuesta por fila."));
      return;
    }
    const m = autoMap(t.headers, questions);
    setTable(t);
    setSource(name);
    setMapping(m);
    setError("");
    onChange({ ...buildRows(t, m, questions), mapping: m, headers: t.headers });
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    if (f.size > 5_000_000) return setError(tr("El archivo es demasiado grande (máx. 5 MB)."));
    setBusy(true);
    try {
      const isXlsx = /\.xlsx$/i.test(f.name);
      const t = isXlsx ? await readXlsx(await f.arrayBuffer()) : parseCsv(await f.text());
      applyTable(t, f.name);
    } catch {
      setError(tr("No pudimos leer el archivo. Usa Excel (.xlsx) o CSV."));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onSheet() {
    if (!sheetUrl.trim()) return;
    setBusy(true);
    try {
      const r = await fetch("/api/web/sheet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: sheetUrl }) });
      const d = await r.json().catch(() => ({}));
      if (!d?.ok) setError(tr(String(d?.reason || "No pudimos leer la hoja. Intenta de nuevo en un momento.")));
      else applyTable(parseCsv(String(d.csv)), "Google Sheets");
    } catch {
      setError(tr("No pudimos leer la hoja. Intenta de nuevo en un momento."));
    } finally {
      setBusy(false);
    }
  }

  function setCol(entry: string, col: number) {
    const m = { ...mapping, [entry]: col };
    setMapping(m);
    if (table) onChange({ ...buildRows(table, m, questions), mapping: m, headers: table.headers });
  }

  function clear() {
    setTable(null);
    setSource("");
    setMapping({});
    setError("");
    onChange(null);
  }

  const mappedCount = Object.values(mapping).filter((c) => c >= 0).length;

  if (!allowed) {
    return (
      <fieldset className="group data data-locked">
        <legend>{tr("Usar mis datos (opcional)")}</legend>
        <p className="group-hint">{tr("Disponible con créditos comprados o regalados: cada fila de tu Excel, CSV o Google Sheets se envía como una respuesta.")}</p>
        <button type="button" className="b b-small b-ghost" onClick={onBuy}>
          {tr("Comprar créditos")}
        </button>
      </fieldset>
    );
  }

  return (
    <fieldset className="group data">
      <legend>{tr("Usar mis datos (opcional)")}</legend>
      <p className="group-hint">
        {tr("Sube un Excel o CSV, o pega el link de una hoja de Google Sheets. La primera fila son los títulos; cada fila de abajo será una respuesta.")}
      </p>

      {!table && (
        <div className="data-pick">
          <button type="button" className="b b-small b-ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? tr("Leyendo…") : tr("Subir Excel o CSV")}
          </button>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,text/csv" hidden onChange={(e) => onFile(e.target.files?.[0])} />
          <form
            className="data-sheet"
            onSubmit={(e) => {
              e.preventDefault();
              void onSheet();
            }}
          >
            <input
              type="url"
              inputMode="url"
              placeholder={tr("o pega el link de Google Sheets")}
              aria-label={tr("Link de Google Sheets")}
              value={sheetUrl}
              onChange={(e) => setSheetUrl(e.target.value)}
            />
            <button type="submit" className="b b-small b-ghost" disabled={busy || !sheetUrl.trim()}>
              {tr("Cargar hoja")}
            </button>
          </form>
        </div>
      )}
      {error && (
        <p className="fh-err" role="alert">
          {error}
        </p>
      )}

      {table && built && (
        <div className="data-box">
          <div className="data-sum">
            <p>
              {tr("{src}: {r} filas, {m} de {q} preguntas con columna.", {
                src: source,
                r: Math.min(table.rows.length, MAX_DATA_ROWS),
                m: mappedCount,
                q: questions.length,
              })}
              {table.rows.length > MAX_DATA_ROWS ? ` ${tr("Se usan las primeras {n}.", { n: MAX_DATA_ROWS })}` : ""}
            </p>
            <button type="button" className="b b-small b-ghost" onClick={clear}>
              {tr("Quitar datos")}
            </button>
          </div>
          {(() => {
            const withIssues = questions.filter((q) => (built.issues[q.entry] ?? []).length > 0);
            if (!withIssues.length) return null;
            return (
              <div className="data-issues" role="status">
                <p>{tr("Valores que no coinciden con las opciones de la pregunta (Google podría rechazar esas respuestas):")}</p>
                <ul>
                  {withIssues.slice(0, 5).map((q) => {
                    const bad = built.issues[q.entry];
                    const vars = { q: q.title.length > 60 ? `${q.title.slice(0, 57)}…` : q.title, n: bad.length, row: bad[0].row, v: bad[0].value };
                    return <li key={q.entry}>{bad.length === 1 ? tr("{q}: 1 valor (fila {row}: “{v}”)", vars) : tr("{q}: {n} valores (fila {row}: “{v}”)", vars)}</li>;
                  })}
                </ul>
                {withIssues.length > 5 && <p>{tr("y {n} preguntas más.", { n: withIssues.length - 5 })}</p>}
              </div>
            );
          })()}
          <details className="data-cols" open={mappedCount < questions.length}>
            <summary>{tr("Revisar columnas ({m} de {q} asociadas)", { m: mappedCount, q: questions.length })}</summary>
          <ul className="data-map">
            {questions.map((q) => {
              const col = mapping[q.entry] ?? -1;
              const bad = built.issues[q.entry] ?? [];
              const sample = col >= 0 ? built.rows.find((r) => r[q.entry])?.[q.entry] : "";
              return (
                <li key={q.entry} className={col >= 0 ? "on" : ""}>
                  <span className="data-q">{q.title}</span>
                  <select value={col} aria-label={tr("Columna para “{q}”", { q: q.title })} onChange={(e) => setCol(q.entry, Number(e.target.value))}>
                    <option value={-1}>{tr("Sin columna: usar la configuración")}</option>
                    {table.headers.map((h, i) => (
                      <option key={`${i}-${h}`} value={i}>
                        {h || tr("Columna {n}", { n: i + 1 })}
                      </option>
                    ))}
                  </select>
                  {sample && <span className="data-ex">{tr("Ej.: {v}", { v: sample.replace(/\|/g, ", ") })}</span>}
                  {bad.length > 0 && (
                    <span className="data-bad">{bad.length === 1 ? tr("1 no coincide") : tr("{n} no coinciden", { n: bad.length })}</span>
                  )}
                </li>
              );
            })}
          </ul>
          </details>
          <p className="fine">{tr("Las preguntas sin columna y las celdas vacías se llenan con la configuración de cada pregunta.")}</p>
        </div>
      )}
    </fieldset>
  );
}
