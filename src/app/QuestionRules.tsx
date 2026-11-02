"use client";

import { useState } from "react";
import type { QConf } from "./QuestionEditors";
import { useLang } from "./LangProvider";

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
  const { tr } = useLang();
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
          {tr("↳ Depende de {list}", { list: [...new Set(rules.map((r) => tr("la pregunta {n}", { n: numberOf(r.entry) })))].join(tr(" y ")) })}
        </p>
      )}
      {!open ? (
        <button type="button" className="linkish" onClick={() => setOpen(true)}>
          {tr("+ Agregar condición")}
        </button>
      ) : (
        <div className="qrules-box">
          {rules.map((r, i) => (
            <p key={i} className="qrules-item">
              {tr("Si la pregunta {n} es", { n: numberOf(r.entry) })} <b>“{r.equals}”</b> →{" "}
              {r.value ? (
                <>
                  {tr("responder")} <b>“{r.value}”</b>
                </>
              ) : (
                <b>{tr("dejar vacía")}</b>
              )}{" "}
              <button type="button" className="linkish" onClick={() => onChange({ when: rules.filter((_, j) => j !== i) })}>
                {tr("quitar")}
              </button>
            </p>
          ))}
          <div className="qrules-row">
            <span>{tr("Si la pregunta")}</span>
            <select
              aria-label={tr("Pregunta de la que depende")}
              value={src.entry}
              onChange={(e) => setDraft({ entry: e.target.value, equals: "", value: draft.value })}
            >
              {sources.map((s) => (
                <option key={s.entry} value={s.entry}>
                  {numberOf(s.entry)}. {s.title.slice(0, 50)}
                </option>
              ))}
            </select>
            <span>{tr("es")}</span>
            <select aria-label={tr("Respuesta que activa la condición")} value={draft.equals} onChange={(e) => setDraft({ ...draft, equals: e.target.value })}>
              <option value="">{tr("elige…")}</option>
              {src.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            <span>→</span>
            {q.options.length ? (
              <select aria-label={tr("Qué responder")} value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })}>
                <option value="">{tr("dejar vacía")}</option>
                {q.options.map((o) => (
                  <option key={o} value={o}>
                    {tr("responder “{o}”", { o })}
                  </option>
                ))}
              </select>
            ) : (
              <input
                aria-label={tr("Qué responder")}
                placeholder={tr("vacío = dejar sin responder")}
                maxLength={300}
                value={draft.value}
                onChange={(e) => setDraft({ ...draft, value: e.target.value.replace(/\|/g, "") })}
              />
            )}
            <button type="button" className="b b-small b-ghost" onClick={add} disabled={!draft.equals}>
              {tr("Agregar")}
            </button>
          </div>
          <p className="q-hint">
            {tr(
              "Útil cuando una pregunta solo aplica según una respuesta anterior (ej. “¿Trabajas?” = No → dejar vacía “¿Dónde trabajas?”). Si esa pregunta es obligatoria en Google Forms, ponla en una sección que se salte con ese mismo “No”."
            )}
          </p>
        </div>
      )}
    </div>
  );
}
