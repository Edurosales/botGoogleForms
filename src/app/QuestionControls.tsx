"use client";

/**
 * Controles de UNA pregunta según su tipo: solo se ofrece lo que tiene
 * sentido (en una pregunta de opciones no hay "texto libre", en un texto no
 * hay "porcentajes"), y debajo el editor que corresponde: opciones para
 * tocar, porcentajes, lista, rango de números, fechas u horas.
 */
import { evenWeights, ListEditor, WeightsEditor, type Mode, type QConf } from "./QuestionEditors";
import { useLang } from "./LangProvider";

type Tr = (es: string, vars?: Record<string, string | number>) => string;

type QView = {
  entry: string;
  title: string;
  type: number;
  options: string[];
  validation?: { kind?: string; min?: number | string; max?: number | string } | null;
};

type Kind = "single" | "multi" | "text" | "paragraph" | "date" | "time";

function kindOf(q: QView): Kind {
  if (q.options.length) return q.type === 4 || q.type === 13 ? "multi" : "single";
  if (q.type === 9) return "date";
  if (q.type === 10) return "time";
  if (q.type === 1) return "paragraph";
  return "text";
}

const NUM_HINT = /(edad|años|age|cantidad|n[uú]mero|cu[aá]nt|horas|peso|altura|ingreso|precio|monto|nota|puntaje)/i;

type UiMode = Mode | "range";

function modesFor(q: QView, aiAllowed: boolean, tr: Tr): { value: UiMode; label: string; disabled?: boolean }[] {
  const ai = { value: "ai" as const, label: aiAllowed ? tr("Con IA (respuestas naturales)") : tr("Con IA (necesita créditos)"), disabled: !aiAllowed };
  switch (kindOf(q)) {
    case "single":
      return [
        { value: "random", label: tr("Al azar entre las opciones") },
        { value: "weighted", label: tr("Porcentajes por opción") },
        { value: "fixed", label: tr("Solo las opciones que elija") },
        ai,
      ];
    case "multi":
      return [
        { value: "random", label: tr("Al azar (1 a 3 casillas)") },
        { value: "weighted", label: tr("Porcentaje por casilla") },
        { value: "fixed", label: tr("Marcar siempre estas casillas") },
        ai,
      ];
    case "date":
      return [
        { value: "random", label: tr("Fecha al azar") },
        { value: "range", label: tr("Entre dos fechas") },
        { value: "fixed", label: tr("Una fecha exacta") },
      ];
    case "time":
      return [
        { value: "random", label: tr("Hora al azar") },
        { value: "range", label: tr("Entre dos horas") },
        { value: "fixed", label: tr("Una hora exacta") },
      ];
    case "paragraph":
      return [
        { value: "random", label: tr("Automático (según la pregunta)") },
        { value: "list", label: tr("Varios textos (uno por línea)") },
        { value: "fixed", label: tr("Un texto fijo") },
        ai,
      ];
    default: {
      const numeric = q.validation?.kind === "number" || NUM_HINT.test(q.title);
      return [
        { value: "random", label: tr("Automático (según la pregunta)") },
        { value: "list", label: tr("Varios datos (uno por línea)") },
        ...(numeric ? [{ value: "range" as const, label: tr("Número en un rango") }] : []),
        { value: "fixed", label: tr("Un valor fijo") },
        ai,
      ];
    }
  }
}

const RANGE_NUM = /^(\d{1,9})\s*[-–]\s*(\d{1,9})$/;
const RANGE_DATE = /^(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})$/;
const RANGE_TIME = /^(\d{1,2}:\d{2})\s*~\s*(\d{1,2}:\d{2})$/;

/** El modo que se ve en pantalla ("rango" se guarda como Fijo con valor "a-b" / "a~b"). */
function uiModeOf(q: QView, conf: QConf): UiMode {
  if (conf.mode !== "fixed") return conf.mode;
  const v = (conf.value ?? "").trim();
  const k = kindOf(q);
  if ((k === "date" && RANGE_DATE.test(v)) || (k === "time" && RANGE_TIME.test(v)) || (k === "text" && RANGE_NUM.test(v))) return "range";
  return "fixed";
}

export function QuestionControls({
  q,
  index,
  conf,
  aiAllowed,
  total,
  onChange,
}: {
  q: QView;
  index: number;
  conf: QConf;
  aiAllowed: boolean;
  total: number;
  onChange: (patch: Partial<QConf>) => void;
}) {
  const { tr } = useLang();
  const kind = kindOf(q);
  const modes = modesFor(q, aiAllowed, tr);
  const ui = uiModeOf(q, conf);
  const selectId = `mode-${q.entry}`;
  const v = (conf.value ?? "").trim();

  function pickMode(next: UiMode) {
    if (next === "weighted") {
      onChange({ mode: "weighted", weights: conf.weights?.length ? conf.weights : evenWeights(q.options.length) });
    } else if (next === "range") {
      const min = q.validation?.min !== undefined ? String(q.validation.min) : "18";
      const max = q.validation?.max !== undefined ? String(q.validation.max) : "65";
      onChange({ mode: "fixed", value: kind === "date" ? "2025-01-01~2025-12-31" : kind === "time" ? "08:00~18:00" : `${min}-${max}` });
    } else if (next === "fixed") {
      const keep = kind !== "single" && kind !== "multi" && !RANGE_NUM.test(v) && !RANGE_DATE.test(v) && !RANGE_TIME.test(v);
      onChange({ mode: "fixed", value: keep ? v : "" });
    } else {
      onChange({ mode: next });
    }
  }

  const chips = new Set(v.split("|").map((x) => x.trim()).filter((x) => q.options.includes(x)));
  const toggleChip = (opt: string) => {
    const n = new Set(chips);
    if (n.has(opt)) n.delete(opt);
    else n.add(opt);
    onChange({ value: q.options.filter((o) => n.has(o)).join("|") });
  };

  const numRange = v.match(RANGE_NUM);
  const dateRange = v.match(RANGE_DATE);
  const timeRange = v.match(RANGE_TIME);

  return (
    <>
      <div className="q-config">
        <label className="sr" htmlFor={selectId}>
          {tr("Cómo responder la pregunta {n}", { n: index + 1 })}
        </label>
        <select id={selectId} value={ui} onChange={(e) => pickMode(e.target.value as UiMode)}>
          {modes.map((m) => (
            <option key={m.value} value={m.value} disabled={m.disabled}>
              {m.label}
            </option>
          ))}
        </select>

        {ui === "fixed" && (kind === "text" || kind === "paragraph") && (
          <input
            type="text"
            maxLength={300}
            aria-label={tr("Valor fijo para la pregunta {n}", { n: index + 1 })}
            placeholder={kind === "paragraph" ? tr("El texto que se enviará siempre") : tr("Ej: Lima")}
            value={conf.value}
            onChange={(e) => onChange({ value: e.target.value.replace(/\|/g, "") })}
          />
        )}
        {ui === "fixed" && kind === "date" && (
          <input
            type="date"
            aria-label={tr("Fecha para la pregunta {n}", { n: index + 1 })}
            value={/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ""}
            onChange={(e) => onChange({ value: e.target.value })}
          />
        )}
        {ui === "fixed" && kind === "time" && (
          <input
            type="time"
            aria-label={tr("Hora para la pregunta {n}", { n: index + 1 })}
            value={/^\d{1,2}:\d{2}$/.test(v) ? v : ""}
            onChange={(e) => onChange({ value: e.target.value })}
          />
        )}
        {conf.mode === "ai" && (
          <input
            type="text"
            maxLength={300}
            aria-label={tr("Indicación para la IA en la pregunta {n}", { n: index + 1 })}
            placeholder={tr("Qué debe responder la IA (ej: opiniones positivas sobre el curso)")}
            title={tr("Indicación para la IA. Cada respuesta tendrá como máximo 8 palabras.")}
            value={conf.prompt ?? ""}
            onChange={(e) => onChange({ prompt: e.target.value })}
          />
        )}
      </div>

      {conf.mode === "ai" && <p className="q-hint">{tr("Indicación para la IA. Cada respuesta tendrá como máximo 8 palabras.")}</p>}

      {ui === "fixed" && (kind === "single" || kind === "multi") && (
        <div className="chips" role="group" aria-label={tr("Opciones para la pregunta {n}", { n: index + 1 })}>
          {q.options.map((opt) => (
            <button
              key={opt}
              type="button"
              className={`chip${chips.has(opt) ? " on" : ""}`}
              aria-pressed={chips.has(opt)}
              onClick={() => toggleChip(opt)}
            >
              {chips.has(opt) ? "✓ " : ""}
              {opt}
            </button>
          ))}
          <p className="q-hint">
            {kind === "multi"
              ? chips.size
                ? tr("Cada respuesta marcará estas {n} casillas.", { n: chips.size })
                : tr("Toca las casillas que quieres marcar siempre.")
              : chips.size > 1
                ? tr("Cada respuesta elegirá al azar una de estas {n}.", { n: chips.size })
                : chips.size === 1
                  ? tr("Todas las respuestas elegirán esta opción.")
                  : tr("Toca una o varias opciones.")}
          </p>
        </div>
      )}

      {ui === "range" && kind === "text" && (
        <div className="range-row">
          <label>
            {tr("Desde")}
            <input type="number" value={numRange?.[1] ?? ""} onChange={(e) => onChange({ value: `${e.target.value || 0}-${numRange?.[2] ?? "65"}` })} />
          </label>
          <label>
            {tr("Hasta")}
            <input type="number" value={numRange?.[2] ?? ""} onChange={(e) => onChange({ value: `${numRange?.[1] ?? "18"}-${e.target.value || 0}` })} />
          </label>
          <p className="q-hint">{tr("Cada respuesta tendrá un número entero al azar dentro del rango.")}</p>
        </div>
      )}
      {ui === "range" && kind === "date" && (
        <div className="range-row">
          <label>
            {tr("Desde")}
            <input type="date" value={dateRange?.[1] ?? ""} onChange={(e) => onChange({ value: `${e.target.value}~${dateRange?.[2] ?? e.target.value}` })} />
          </label>
          <label>
            {tr("Hasta")}
            <input type="date" value={dateRange?.[2] ?? ""} onChange={(e) => onChange({ value: `${dateRange?.[1] ?? e.target.value}~${e.target.value}` })} />
          </label>
        </div>
      )}
      {ui === "range" && kind === "time" && (
        <div className="range-row">
          <label>
            {tr("Desde")}
            <input type="time" value={timeRange?.[1] ?? ""} onChange={(e) => onChange({ value: `${e.target.value}~${timeRange?.[2] ?? e.target.value}` })} />
          </label>
          <label>
            {tr("Hasta")}
            <input type="time" value={timeRange?.[2] ?? ""} onChange={(e) => onChange({ value: `${timeRange?.[1] ?? e.target.value}~${e.target.value}` })} />
          </label>
        </div>
      )}

      {conf.mode === "weighted" && q.options.length > 0 && (
        <WeightsEditor question={q} weights={conf.weights ?? evenWeights(q.options.length)} onChange={(weights) => onChange({ weights })} />
      )}
      {conf.mode === "list" && (
        <ListEditor
          id={`list-${q.entry}`}
          label={tr("Respuestas para la pregunta {n}", { n: index + 1 })}
          value={conf.value}
          order={conf.order ?? "random"}
          total={total}
          onChange={(patch) => onChange(patch)}
        />
      )}
    </>
  );
}
