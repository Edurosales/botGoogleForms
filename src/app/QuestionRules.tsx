"use client";

import { useState } from "react";
import type { QConf } from "./QuestionEditors";

type QView = { entry: string; title: string; type: number; options: string[] };
type Rule = { entry: string; equals: string; value: string };

/**
 * Condiciones de UNA pregunta: "si la pregunta N responde X, esta responde Y
 * (o se deja vacía)". Solo se puede depender de preguntas ANTERIORES con
 * opciones, igual que los saltos de sección de Google Forms.
 */
export function QuestionRules({
  q,
  index,
  conf,
  all,
  onChange,
}: {
  q: QView;
  index: number;
  conf: QConf;
  all: QView[];
  onChange: (patch: Partial<QConf>) => void;
}) {
  const rules: Rule[] = conf.when ?? [];
  const sources = all.slice(0, index).filter((x) => x.options.length > 0);
  const [open, setOpen] = useState(rules.length > 0);
  const [draft, setDraft] = useState<Rule>({ entry: sources[0]?.entry ?? "", equals: "", value: "" });

  if (!sources.length) return null;
  const numberOf = (entry: string) => all.findIndex((x) => x.entry === entry) + 1;
  const src = sources.find((x) => x.entry === draft.entry) ?? sources[0];

  function add() {
    if (!draft.entry || !draft.equals) return;
    onChange({ when: [...rules, { ...draft, entry: src.entry }] });
    setDraft({ entry: src.entry, equals: "", value: "" });
  }

  return (
    <div className="qrules">
      {rules.length > 0 && (
        <p className="qrules-flow">
          ↳ Depende de {[...new Set(rules.map((r) => `la pregunta ${numberOf(r.entry)}`))].join(" y ")}
        </p>
      )}
      {!open ? (
        <button type="button" className="linkish" onClick={() => setOpen(true)}>
          + Agregar condición
        </button>
      ) : (
        <div className="qrules-box">
          {rules.map((r, i) => (
            <p key={i} className="qrules-item">
              Si la pregunta {numberOf(r.entry)} es <b>“{r.equals}”</b> → {r.value ? <>responder <b>“{r.value}”</b></> : <b>dejar vacía</b>}{" "}
              <button type="button" className="linkish" onClick={() => onChange({ when: rules.filter((_, j) => j !== i) })}>
                quitar
              </button>
            </p>
          ))}
          <div className="qrules-row">
            <span>Si la pregunta</span>
            <select
              aria-label="Pregunta de la que depende"
              value={src.entry}
              onChange={(e) => setDraft({ entry: e.target.value, equals: "", value: draft.value })}
            >
              {sources.map((s) => (
                <option key={s.entry} value={s.entry}>
                  {numberOf(s.entry)}. {s.title.slice(0, 50)}
                </option>
              ))}
            </select>
            <span>es</span>
            <select aria-label="Respuesta que activa la condición" value={draft.equals} onChange={(e) => setDraft({ ...draft, equals: e.target.value })}>
              <option value="">elige…</option>
              {src.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            <span>→</span>
            {q.options.length ? (
              <select aria-label="Qué responder" value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })}>
                <option value="">dejar vacía</option>
                {q.options.map((o) => (
                  <option key={o} value={o}>
                    responder “{o}”
                  </option>
                ))}
              </select>
            ) : (
              <input
                aria-label="Qué responder"
                placeholder="vacío = dejar sin responder"
                maxLength={300}
                value={draft.value}
                onChange={(e) => setDraft({ ...draft, value: e.target.value.replace(/\|/g, "") })}
              />
            )}
            <button type="button" className="b b-small b-ghost" onClick={add} disabled={!draft.equals}>
              Agregar
            </button>
          </div>
          <p className="q-hint">
            Útil cuando una pregunta solo aplica según una respuesta anterior (ej. “¿Trabajas?” = No → dejar vacía “¿Dónde trabajas?”). Si esa
            pregunta es obligatoria en Google Forms, ponla en una sección que se salte con ese mismo “No”.
          </p>
        </div>
      )}
    </div>
  );
}
