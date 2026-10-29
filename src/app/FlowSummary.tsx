"use client";

import type { QConf, QConfMap } from "./QuestionEditors";

type QView = { entry: string; title: string; type: number; options: string[]; section?: number; jumps?: Record<string, number> | null };

/** % de respuestas que elegirán cada opción con la configuración actual (aprox.). */
function optionShares(q: QView, conf: QConf | undefined): Record<string, number> {
  const n = q.options.length;
  const even = Object.fromEntries(q.options.map((o) => [o, 100 / n]));
  if (!conf) return even;
  if (conf.mode === "weighted" && conf.weights?.length) {
    const w = q.options.map((_, i) => Math.max(0, Number(conf.weights?.[i]) || 0));
    const sum = w.reduce((a, b) => a + b, 0);
    if (sum > 0) return Object.fromEntries(q.options.map((o, i) => [o, (w[i] / sum) * 100]));
  }
  if (conf.mode === "fixed" && conf.value) {
    const chosen = conf.value.split("|").map((v) => v.trim()).filter((v) => q.options.includes(v));
    if (chosen.length) return Object.fromEntries(q.options.map((o) => [o, chosen.includes(o) ? 100 / chosen.length : 0]));
  }
  return even;
}

/** Qué condición abre cada sección: "P1 = Sí". */
export function sectionGates(questions: QView[]): Map<number, string[]> {
  const gates = new Map<number, string[]>();
  questions.forEach((q, i) => {
    for (const [opt, sec] of Object.entries(q.jumps ?? {})) {
      const list = gates.get(sec) ?? [];
      list.push(`P${i + 1} = “${opt}”`);
      gates.set(sec, list);
    }
  });
  return gates;
}

/**
 * Tarjeta "Flujo del formulario": qué preguntas cambian el camino, a qué
 * sección lleva cada respuesta y qué parte de las respuestas irá por cada
 * camino según la configuración (para que se entienda por qué a veces se
 * abre una sección y a veces no).
 */
export default function FlowSummary({ questions, qConfig }: { questions: QView[]; qConfig: QConfMap }) {
  const branching = questions.map((q, i) => ({ q, i })).filter(({ q }) => q.jumps && Object.keys(q.jumps).length > 0);
  if (!branching.length) return null;
  const firstQuestionOf = (sec: number) => questions.findIndex((q) => (q.section ?? 1) === sec) + 1;

  return (
    <div className="flow">
      <p className="flow-title">Flujo del formulario</p>
      <p className="fine">
        Tu formulario abre secciones según lo que se responda. Cada respuesta sigue su propio camino, como una persona: las preguntas de las
        secciones que no se abren quedan vacías. Para cambiar cuántas respuestas van por cada camino, usa <b>Porcentajes</b> o <b>Fijo</b> en
        la pregunta que salta.
      </p>
      {branching.map(({ q, i }) => {
        const shares = optionShares(q, qConfig[q.entry]);
        return (
          <div key={q.entry} className="flow-q">
            <p className="flow-qtitle">
              P{i + 1}. {q.title}
            </p>
            <ul>
              {q.options.map((opt) => {
                const sec = q.jumps?.[opt];
                const pct = Math.round(shares[opt] ?? 0);
                return (
                  <li key={opt}>
                    <span className="flow-opt">“{opt}”</span>
                    <span className="flow-arrow">→</span>
                    <span>
                      {sec ? `sección ${sec}${firstQuestionOf(sec) > 0 ? ` (desde P${firstQuestionOf(sec)})` : ""}` : "sigue a la sección siguiente"}
                    </span>
                    <span className="flow-bar" aria-label={`${pct}% de las respuestas`}>
                      <i style={{ width: `${pct}%` }} />
                    </span>
                    <span className="flow-pct">{pct}%</span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
