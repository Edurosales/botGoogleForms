"use client";

import { useState } from "react";
import { FREE_TEST_CAP, SUPPORTED_LANGUAGES } from "@/lib/webConfig";

type Mode = "ai" | "random" | "fixed";

interface QuestionView {
  entry: string;
  title: string;
  type: number;
  typeName: string;
  options: string[];
  required: boolean;
}

interface FormView {
  title: string;
  description: string;
  numSections: number;
  questions: QuestionView[];
}

type Step = "input" | "blocked" | "config" | "sending" | "result" | "error";

export default function HerramientaClient() {
  const [step, setStep] = useState<Step>("input");
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState("");
  const [form, setForm] = useState<FormView | null>(null);
  const [language, setLanguage] = useState<string>(SUPPORTED_LANGUAGES[0].code);
  const [total, setTotal] = useState(FREE_TEST_CAP);
  const [customInstructions, setCustomInstructions] = useState("");
  const [qConfig, setQConfig] = useState<Record<string, { mode: Mode; value: string }>>({});
  const [result, setResult] = useState<{ sent: number; failed: number; total: number } | null>(null);

  async function handleAnalyze() {
    setMessage("");
    setStep("sending");
    try {
      const res = await fetch("/api/web/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!data.ok) {
        setMessage(data.reason || data.error || "No se pudo leer el formulario.");
        setStep(data.blocked ? "blocked" : "error");
        return;
      }
      setForm(data.form);
      const initialConfig: Record<string, { mode: Mode; value: string }> = {};
      for (const q of data.form.questions as QuestionView[]) {
        initialConfig[q.entry] = { mode: "ai", value: "" };
      }
      setQConfig(initialConfig);
      setStep("config");
    } catch {
      setMessage("No se pudo conectar con el servidor.");
      setStep("error");
    }
  }

  async function handleRun() {
    if (!form) return;
    setStep("sending");
    setMessage("");
    try {
      const res = await fetch("/api/web/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          total,
          language,
          customInstructions,
          qConfig,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setMessage(data.reason || data.error || "No se pudo completar el envío.");
        setStep(data.blocked ? "blocked" : "error");
        return;
      }
      setResult({ sent: data.sent, failed: data.failed, total: data.total });
      setStep("result");
    } catch {
      setMessage("No se pudo conectar con el servidor.");
      setStep("error");
    }
  }

  function reset() {
    setStep("input");
    setUrl("");
    setForm(null);
    setResult(null);
    setMessage("");
  }

  if (step === "input" || step === "sending") {
    return (
      <div className="tool-card">
        <label htmlFor="form-url">Link de tu Google Form (debe ser público)</label>
        <input
          id="form-url"
          type="url"
          placeholder="https://docs.google.com/forms/d/e/.../viewform"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={step === "sending"}
        />
        <button className="btn wa" onClick={handleAnalyze} disabled={!url.trim() || step === "sending"}>
          {step === "sending" ? "Analizando…" : "Analizar formulario"}
        </button>
        {message && <p className="tool-error">{message}</p>}
      </div>
    );
  }

  if (step === "blocked" || step === "error") {
    return (
      <div className="tool-card">
        <p className="tool-error">{message}</p>
        <button className="btn" onClick={reset}>
          Probar con otro link
        </button>
      </div>
    );
  }

  if (step === "config" && form) {
    return (
      <div className="tool-card">
        <h2>{form.title}</h2>
        <p className="lead">{form.questions.length} preguntas detectadas.</p>

        <label htmlFor="lang">Idioma de las respuestas</label>
        <select id="lang" value={language} onChange={(e) => setLanguage(e.target.value)}>
          {SUPPORTED_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>

        <label htmlFor="total">Cantidad de respuestas (máx {FREE_TEST_CAP} en fase de pruebas)</label>
        <input
          id="total"
          type="number"
          min={1}
          max={FREE_TEST_CAP}
          value={total}
          onChange={(e) => setTotal(Math.min(FREE_TEST_CAP, Math.max(1, Number(e.target.value) || 1)))}
        />

        <label htmlFor="persona">Instrucciones / perfil (opcional)</label>
        <textarea
          id="persona"
          placeholder='Ej: "Actúa como estudiante universitario de 20 años"'
          value={customInstructions}
          onChange={(e) => setCustomInstructions(e.target.value)}
        />

        <h3>Configurar por pregunta</h3>
        <div className="tool-questions">
          {form.questions.map((q) => (
            <div className="tool-question" key={q.entry}>
              <p>
                <b>{q.title}</b> <small>({q.typeName})</small>
              </p>
              <select
                value={qConfig[q.entry]?.mode ?? "ai"}
                onChange={(e) =>
                  setQConfig((prev) => ({
                    ...prev,
                    [q.entry]: { mode: e.target.value as Mode, value: prev[q.entry]?.value ?? "" },
                  }))
                }
              >
                <option value="ai">IA</option>
                <option value="random">Aleatorio</option>
                <option value="fixed">Fijo</option>
              </select>
              {qConfig[q.entry]?.mode === "fixed" && (
                <input
                  type="text"
                  placeholder={q.options.length ? q.options.join(" | ") : "Valor fijo"}
                  value={qConfig[q.entry]?.value ?? ""}
                  onChange={(e) =>
                    setQConfig((prev) => ({
                      ...prev,
                      [q.entry]: { mode: "fixed", value: e.target.value },
                    }))
                  }
                />
              )}
            </div>
          ))}
        </div>

        <button className="btn wa" onClick={handleRun}>
          Generar y enviar {total} respuesta(s)
        </button>
        <button className="btn" onClick={reset}>
          Cancelar
        </button>
      </div>
    );
  }

  if (step === "result" && result) {
    return (
      <div className="tool-card">
        <h2>✅ Enviado</h2>
        <p className="lead">
          {result.sent} de {result.total} respuestas enviadas correctamente
          {result.failed > 0 ? ` (${result.failed} fallaron)` : ""}.
        </p>
        <button className="btn wa" onClick={reset}>
          Probar otro formulario
        </button>
      </div>
    );
  }

  return null;
}
