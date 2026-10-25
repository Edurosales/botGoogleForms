"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { QConfMap } from "./QuestionEditors";

export type Preset = {
  id: string;
  name: string;
  total: number;
  language: string;
  custom_instructions: string;
  q_config: QConfMap;
  updated_at: string;
};

export type PresetData = { total: number; language: string; customInstructions: string; qConfig: QConfMap };

/**
 * Configuraciones guardadas de ESTE formulario (cantidad, idioma, perfil y
 * cómo se responde cada pregunta). Clientes con créditos guardan y aplican;
 * los gratuitos ven la función con candado.
 */
export default function PresetsBar({
  formId,
  formTitle,
  current,
  onApply,
}: {
  formId: string;
  formTitle: string;
  current: PresetData;
  onApply: (p: PresetData, name: string) => void;
}) {
  const [presets, setPresets] = useState<Preset[] | null>(null);
  const [premium, setPremium] = useState(false);
  const [unavailable, setUnavailable] = useState("");
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/web/presets?formId=${encodeURIComponent(formId)}`, { cache: "no-store" }).catch(() => null);
    const d = await r?.json().catch(() => null);
    if (!d?.ok) return;
    setPremium(d.premium === true);
    setPresets(Array.isArray(d.presets) ? d.presets : []);
    setUnavailable(typeof d.unavailable === "string" ? d.unavailable : "");
  }, [formId]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function save() {
    if (!name.trim()) {
      setMsg("Ponle un nombre (ej: Encuesta clientes 60% mujeres).");
      return;
    }
    setSaving(true);
    setMsg("");
    const r = await fetch("/api/web/presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ formId, formTitle, name: name.trim(), ...current }),
    }).catch(() => null);
    const d = await r?.json().catch(() => null);
    setSaving(false);
    if (d?.ok) {
      setMsg(`Guardada como “${name.trim()}”.`);
      setName("");
      setOpen(false);
      load();
    } else setMsg(String(d?.error || "No se pudo guardar."));
  }

  async function remove(id: string) {
    await fetch(`/api/web/presets?id=${id}`, { method: "DELETE" }).catch(() => null);
    setSelected("");
    load();
  }

  function apply() {
    const p = presets?.find((x) => x.id === selected);
    if (!p) return;
    onApply({ total: p.total, language: p.language, customInstructions: p.custom_instructions, qConfig: p.q_config }, p.name);
    setMsg(`Aplicaste “${p.name}”.`);
  }

  if (presets === null || unavailable) return null;

  if (!premium) {
    return (
      <div className="presets presets-locked">
        <p>
          <span aria-hidden="true">🔒</span> <strong>Guarda esta configuración</strong> y reúsala en tu próximo envío de este
          formulario. Disponible con créditos comprados.
        </p>
        <Link className="b b-small b-ghost" href="/comprar-creditos">
          Ver créditos
        </Link>
      </div>
    );
  }

  return (
    <div className="presets">
      <p className="presets-title">Configuraciones guardadas de este formulario</p>
      {presets.length > 0 ? (
        <div className="presets-row">
          <select aria-label="Configuración guardada" value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">Elige una…</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.total} respuestas
              </option>
            ))}
          </select>
          <button type="button" className="b b-small b-primary" onClick={apply} disabled={!selected}>
            Usar
          </button>
          {selected && (
            <button type="button" className="b b-small b-ghost b-danger" onClick={() => remove(selected)}>
              Borrar
            </button>
          )}
        </div>
      ) : (
        <p className="fine">Todavía no guardaste ninguna para este formulario.</p>
      )}
      {open ? (
        <div className="presets-row">
          <input
            type="text"
            maxLength={60}
            placeholder="Nombre (ej: Prueba final 200 respuestas)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Nombre de la configuración"
          />
          <button type="button" className="b b-small b-primary" onClick={save} disabled={saving}>
            {saving ? "Guardando…" : "Guardar"}
          </button>
          <button type="button" className="b b-small b-ghost" onClick={() => setOpen(false)}>
            Cancelar
          </button>
        </div>
      ) : (
        <button type="button" className="b b-small b-ghost" onClick={() => setOpen(true)}>
          Guardar la configuración actual
        </button>
      )}
      {msg && (
        <p className="fine" role="status">
          {msg}
        </p>
      )}
    </div>
  );
}
