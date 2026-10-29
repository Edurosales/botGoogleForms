"use client";

/**
 * Editores de cómo se responde cada pregunta (porcentajes, lista, modos por
 * tipo de pregunta). Compartidos por la herramienta.
 */

export type Mode = "ai" | "random" | "fixed" | "weighted" | "list";
export type QConf = {
  mode: Mode;
  value: string;
  prompt?: string;
  /** "weighted": % por opción, alineado con question.options. */
  weights?: number[];
  /** "list": usar las líneas en orden o al azar. */
  order?: "random" | "sequential";
  /** Condiciones: si la pregunta `entry` responde `equals`, esta responde `value` ("" = vacía). */
  when?: { entry: string; equals: string; value: string }[];
};
export type QConfMap = Record<string, QConf>;

export function evenWeights(n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(100 / n);
  return Array.from({ length: n }, (_, i) => (i < 100 - base * n ? base + 1 : base));
}

export function WeightsEditor({
  question,
  weights,
  onChange,
}: {
  question: { entry: string; type: number; options: string[] };
  weights: number[];
  onChange: (w: number[]) => void;
}) {
  const multi = question.type === 4 || question.type === 13;
  const sum = weights.reduce((a, b) => a + (Number(b) || 0), 0);
  return (
    <div className="weights">
      <p className="q-hint">
        {multi
          ? "Probabilidad de que se marque cada opción en cada respuesta."
          : "Qué porcentaje de las respuestas elige cada opción."}
      </p>
      <ul>
        {question.options.map((opt, idx) => {
          const id = `w-${question.entry}-${idx}`;
          return (
            <li key={idx}>
              <label htmlFor={id}>{opt}</label>
              <span className="weights-input">
                <input
                  id={id}
                  type="number"
                  min={0}
                  max={100}
                  inputMode="numeric"
                  value={weights[idx] ?? 0}
                  onChange={(e) => {
                    const next = [...weights];
                    next[idx] = Math.min(100, Math.max(0, Math.round(Number(e.target.value) || 0)));
                    onChange(next);
                  }}
                />
                %
              </span>
            </li>
          );
        })}
      </ul>
      <div className="weights-foot">
        {!multi && (
          <span className={sum === 100 ? "weights-sum ok" : "weights-sum"}>
            Total: {sum}%{sum !== 100 ? " — se ajusta en proporción al enviar" : ""}
          </span>
        )}
        <button type="button" className="link-btn" onClick={() => onChange(evenWeights(question.options.length))}>
          Repartir parejo
        </button>
      </div>
    </div>
  );
}

export function ListEditor({
  id,
  label,
  value,
  order,
  total,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  order: "random" | "sequential";
  total: number;
  onChange: (patch: Partial<QConf>) => void;
}) {
  const lines = value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return (
    <div className="listed">
      <label className="sr" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        rows={4}
        maxLength={20000}
        placeholder={"Una respuesta por línea\nMaría Torres\nCarlos Rivas\n…"}
        value={value}
        onChange={(e) => onChange({ value: e.target.value })}
      />
      <div className="listed-foot">
        <span className="q-hint">
          {lines.length} {lines.length === 1 ? "respuesta" : "respuestas"}
          {order === "sequential" && lines.length > 0 && lines.length < total
            ? ` — al acabarse, vuelve a empezar desde la primera`
            : ""}
        </span>
        <span className="seg" role="radiogroup" aria-label="Orden de uso">
          <button type="button" role="radio" aria-checked={order === "random"} onClick={() => onChange({ order: "random" })}>
            Al azar
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={order === "sequential"}
            onClick={() => onChange({ order: "sequential" })}
          >
            En orden
          </button>
        </span>
      </div>
    </div>
  );
}

