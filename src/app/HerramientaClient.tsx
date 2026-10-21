"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SUPPORTED_LANGUAGES } from "@/lib/webConfig";

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

type Step = "input" | "blocked" | "preview" | "queued" | "processing" | "done" | "error";

type SavedDraft = {
  url: string;
  total: number;
  language: string;
  customInstructions: string;
  qConfig: Record<string, { mode: Mode; value: string }>;
};

const DRAFT_KEY = "formsbot_tool_draft";
const FREE_MAX = 30;

export default function HerramientaClient({ initialUrl = "" }: { initialUrl?: string }) {
  const [step, setStep] = useState<Step>("input");
  const [url, setUrl] = useState(initialUrl);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState<FormView | null>(null);
  const [language, setLanguage] = useState<string>(SUPPORTED_LANGUAGES[0].code);
  const [total, setTotal] = useState(FREE_MAX);
  const [customInstructions, setCustomInstructions] = useState("");
  const [qConfig, setQConfig] = useState<Record<string, { mode: Mode; value: string }>>({});
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [user, setUser] = useState<{ email: string; name: string; credits: number } | null>(null);
  const [userChecked, setUserChecked] = useState(false);
  const [progress, setProgress] = useState({ sent: 0, failed: 0, total: 0, queuePosition: 0, isPaid: false });
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Sesión + restaurar borrador tras volver del login de Google ──
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        setUser(d.user ?? null);
        setUserChecked(true);
        if (d.user) {
          try {
            const raw = localStorage.getItem(DRAFT_KEY);
            if (raw) {
              const draft: SavedDraft = JSON.parse(raw);
              localStorage.removeItem(DRAFT_KEY);
              setUrl(draft.url);
              setTotal(draft.total);
              setLanguage(draft.language);
              setCustomInstructions(draft.customInstructions);
              setQConfig(draft.qConfig);
              if (draft.url) void analyze(draft.url);
            }
          } catch {
            /* sin borrador guardado */
          }
        }
      })
      .catch(() => setUserChecked(true));
  }, []);

  // ── Si llegó con ?url=... (desde /sobre o un link viejo /herramienta), auto-analizar ──
  useEffect(() => {
    if (initialUrl) void analyze(initialUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  async function analyze(targetUrl: string) {
    setMessage("");
    setStep("input");
    try {
      const res = await fetch("/api/web/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl }),
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
      setQConfig((prev) => (Object.keys(prev).length ? prev : initialConfig));
      setStep("preview");
    } catch {
      setMessage("No se pudo conectar con el servidor.");
      setStep("error");
    }
  }

  function handleAnalyzeClick() {
    void analyze(url);
  }

  function goLogin() {
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ url, total, language, customInstructions, qConfig } satisfies SavedDraft)
      );
    } catch {
      /* localStorage no disponible, se pierde el borrador — aceptable */
    }
    // Navegación completa a propósito: dispara el flujo OAuth de Google,
    // no es una ruta de página que el router de Next deba manejar.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/api/auth/google?next=/";
  }

  const startPolling = useCallback((id: string) => {
    if (pollRef.current) clearTimeout(pollRef.current);
    let failStreak = 0;
    let stopped = false;

    const tick = async () => {
      if (stopped) return;
      let data: {
        ok?: boolean;
        error?: string;
        reason?: string;
        status?: string;
        sent?: number;
        failed?: number;
        total?: number;
        queuePosition?: number;
      };
      try {
        const res = await fetch(`/api/web/jobs/${id}/tick`, { method: "POST" });
        data = await res.json();
      } catch {
        data = { ok: false };
      }
      if (stopped) return;
      if (!data.ok) {
        failStreak++;
        // Tolera un par de fallos transitorios (red, cold start) antes de rendirse.
        if (failStreak >= 3) {
          stopped = true;
          setMessage(data.reason || data.error || "No se pudo completar el envío. Intenta de nuevo.");
          setStep("error");
          return;
        }
        pollRef.current = setTimeout(tick, 2500);
        return;
      }
      failStreak = 0;
      setProgress((prev) => ({
        ...prev,
        sent: data.sent ?? 0,
        failed: data.failed ?? 0,
        total: data.total ?? 0,
        queuePosition: data.queuePosition ?? 0,
      }));
      if (data.status === "queued") setStep("queued");
      else if (data.status === "processing") setStep("processing");
      else if (data.status === "done") {
        setStep("done");
        stopped = true;
        return;
      } else if (data.status === "failed") {
        // Falló de verdad (ej. la IA no pudo generar las respuestas) —
        // antes esto se mostraba igual que un envío exitoso con 0/30.
        setMessage(data.reason || "No se pudo completar el envío.");
        setStep("error");
        stopped = true;
        return;
      }
      // Solo se programa el siguiente tick cuando este terminó por
      // completo — antes un setInterval fijo disparaba el siguiente
      // tick aunque el anterior (generar con Groq) siguiera en vuelo,
      // y las llamadas solapadas se pisaban entre sí sin avanzar nunca.
      pollRef.current = setTimeout(tick, 2500);
    };

    tick();
  }, []);

  async function handleSend() {
    if (!form) return;
    if (!acceptedTerms) {
      setMessage("Debes aceptar los términos para continuar.");
      return;
    }
    if (!user) {
      goLogin();
      return;
    }
    setMessage("");
    try {
      const res = await fetch("/api/web/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formUrl: url, total, language, customInstructions, qConfig, acceptedTerms }),
      });
      const data = await res.json();
      if (!data.ok) {
        if (data.needsCredits) {
          setMessage(`${data.reason} Compra créditos para enviar más de ${FREE_MAX} respuestas.`);
          setStep("error");
          return;
        }
        setMessage(data.reason || data.error || "No se pudo crear el envío.");
        setStep(data.blocked ? "blocked" : "error");
        return;
      }
      setProgress({ sent: 0, failed: 0, total, queuePosition: data.queuePosition ?? 0, isPaid: total > FREE_MAX });
      setStep(data.status === "queued" ? "queued" : "processing");
      startPolling(data.jobId);
    } catch {
      setMessage("No se pudo conectar con el servidor.");
      setStep("error");
    }
  }

  function reset() {
    setStep("input");
    setUrl("");
    setForm(null);
    setMessage("");
    if (pollRef.current) clearTimeout(pollRef.current);
  }

  const whatsappHref = (() => {
    const number = "51935372306"; // mismo número ya publicado en la landing
    const msg = `Hola, quiero que me ayuden a llenar mi formulario: ${url} — ${total} respuestas`;
    return `https://wa.me/${number}?text=${encodeURIComponent(msg)}`;
  })();

  // ── Render ──────────────────────────────────────────────────────

  const STEP_INDEX: Record<Step, number> = {
    input: 0,
    preview: 1,
    queued: 2,
    processing: 2,
    done: 3,
    blocked: 0,
    error: 0,
  };
  const currentStepIndex = STEP_INDEX[step];
  const stepIndicator = (
    <div className="tool-steps" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className={i < currentStepIndex ? "done" : i === currentStepIndex ? "now" : ""} />
      ))}
    </div>
  );

  if (step === "input") {
    return (
      <div className="tool-card">
        {stepIndicator}
        <h2>Pega el link de tu formulario</h2>
        <div className="tool-warning">
          Tiene que ser público: cualquiera con el link puede verlo sin iniciar sesión. No
          procesamos concursos, sorteos ni votaciones — los rechazamos automáticamente. Este
          servicio todavía está en pruebas, puede no estar disponible en todo momento.
        </div>
        <label htmlFor="form-url">Link de tu Google Form</label>
        <input
          id="form-url"
          type="url"
          placeholder="https://docs.google.com/forms/d/e/.../viewform"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button className="btn wa" onClick={handleAnalyzeClick} disabled={!url.trim()}>
          Probar mi formulario
        </button>
        {message && <p className="tool-error">{message}</p>}
      </div>
    );
  }

  if (step === "blocked" || step === "error") {
    return (
      <div className="tool-card" style={{ textAlign: "center" }}>
        {stepIndicator}
        <span className="tool-status-icon">{step === "blocked" ? "🚫" : "⚠️"}</span>
        <h2>{step === "blocked" ? "No podemos procesar este formulario" : "Algo salió mal"}</h2>
        <p className="tool-error">{message}</p>
        <button className="btn wa" onClick={reset}>
          Probar con otro link
        </button>
      </div>
    );
  }

  if (step === "preview" && form) {
    return (
      <div className="tool-card">
        {stepIndicator}
        <h2>{form.title}</h2>
        <p className="tool-sub">Detectamos {form.questions.length} preguntas. Revisa cómo las vamos a responder.</p>

        <div className="tool-section">
          <h3>Idioma y cantidad</h3>
          <div className="tool-row">
            <div>
              <label htmlFor="lang">Idioma de las respuestas</label>
              <select id="lang" value={language} onChange={(e) => setLanguage(e.target.value)}>
                {SUPPORTED_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="total">Cantidad de respuestas</label>
              <input
                id="total"
                type="number"
                min={1}
                max={500}
                value={total}
                onChange={(e) => setTotal(Math.min(500, Math.max(1, Number(e.target.value) || 1)))}
              />
            </div>
          </div>
          {total > FREE_MAX && (
            <p className="tool-hint">
              Más de {FREE_MAX} respuestas requiere créditos: este envío usaría {total} créditos.
            </p>
          )}
        </div>

        <div className="tool-section">
          <h3>Perfil de quien responde</h3>
          <p className="tool-section-hint">Opcional. Describe quién responde para que la IA mantenga un estilo coherente.</p>
          <textarea
            id="persona"
            placeholder='Ej: estudiante universitario de 20 años'
            value={customInstructions}
            onChange={(e) => setCustomInstructions(e.target.value)}
          />
        </div>

        <div className="tool-section">
          <h3>Respuesta por pregunta</h3>
          <p className="tool-section-hint">IA genera una respuesta natural; aleatorio elige entre las opciones; fijo usa siempre el mismo valor.</p>
          <div className="tool-questions">
            {form.questions.map((q) => (
              <div className="tool-question" key={q.entry}>
                <div className="tool-question-title">
                  <b>{q.title}</b>
                  <small>{q.typeName}</small>
                </div>
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
                      setQConfig((prev) => ({ ...prev, [q.entry]: { mode: "fixed", value: e.target.value } }))
                    }
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="tool-section">
          <label className="tool-check">
            <input type="checkbox" checked={acceptedTerms} onChange={(e) => setAcceptedTerms(e.target.checked)} />
            <span>
              Acepto los{" "}
              <a href="/terminos-herramienta.html" target="_blank" rel="noopener">
                términos del servicio
              </a>
              : el formulario es público, no es concurso ni actividad ilegal, y soy responsable de su uso.
            </span>
          </label>

          {userChecked && !user && (
            <p className="tool-hint">Para enviar necesitas iniciar sesión con Google. No pedimos contraseña.</p>
          )}
          {user && (
            <p className="tool-hint">
              Conectado como {user.email} ({user.credits} créditos). <a href="/mi-cuenta">Ver mi cuenta</a>
            </p>
          )}

          <button className="btn wa" onClick={handleSend} disabled={!acceptedTerms}>
            {user ? `Generar y enviar ${total} respuestas` : "Iniciar sesión con Google y enviar"}
          </button>
          <button className="btn ghost-link" onClick={reset}>
            Cancelar y probar otro link
          </button>
          {message && <p className="tool-error">{message}</p>}
        </div>
      </div>
    );
  }

  if (step === "queued") {
    return (
      <div className="tool-card" style={{ textAlign: "center" }}>
        {stepIndicator}
        <span className="tool-status-icon">⏳</span>
        <h2>En espera</h2>
        <p className="tool-sub">
          {progress.isPaid
            ? "Tu envío pagado tiene prioridad: ya está en la fila de créditos y empezará apenas haya un cupo libre."
            : `El servidor está lleno por ahora. Posición en la cola: ${progress.queuePosition || "calculando"}.`}
        </p>
        <p className="tool-hint">Esta pestaña se actualiza sola. Puedes dejarla abierta o volver luego.</p>
        {!progress.isPaid && (
          <div className="tool-wait-options">
            <a className="btn wa" href="/comprar-creditos" target="_blank" rel="noopener">
              Comprar créditos y pasar al frente
            </a>
            <a className="btn" href={whatsappHref} target="_blank" rel="noopener">
              Prefiero que lo llenen por mí (WhatsApp)
            </a>
            <a className="btn" href="https://licenses-forms.vercel.app/comprar" target="_blank" rel="noopener">
              Comprar el software completo
            </a>
          </div>
        )}
      </div>
    );
  }

  if (step === "processing") {
    const pct = progress.total > 0 ? Math.round(((progress.sent + progress.failed) / progress.total) * 100) : 0;
    return (
      <div className="tool-card" style={{ textAlign: "center" }}>
        {stepIndicator}
        <span className="tool-status-icon">🤖</span>
        <h2>Generando y enviando</h2>
        <p className="tool-sub">
          {progress.sent + progress.failed} de {progress.total} respuestas procesadas.
        </p>
        <div className="tool-progress">
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }

  if (step === "done") {
    const allFailed = progress.sent === 0 && progress.failed > 0;
    return (
      <div className="tool-card" style={{ textAlign: "center" }}>
        {stepIndicator}
        <span className="tool-status-icon">{allFailed ? "⚠️" : "✅"}</span>
        <h2>{allFailed ? "No se pudo enviar ninguna respuesta" : "Enviado"}</h2>
        <p className="tool-sub">
          {allFailed
            ? "Google rechazó los envíos. Puede ser que el formulario cambió, dejó de ser público, o hubo un problema temporal. Vuelve a intentarlo o revisa el link."
            : `${progress.sent} de ${progress.total} respuestas enviadas correctamente${progress.failed > 0 ? `, ${progress.failed} fallaron` : ""}.`}
        </p>
        {!allFailed && (
          <div className="tool-ad-slot" aria-label="Publicidad">
            <div className="ad-slot">
              <script async data-cfasync="false" src="https://bauval.org/14/782dacab651cd462139a728f471d7582"></script>
            </div>
          </div>
        )}
        <div className="tool-wait-options">
          <a className="btn wa" href="/comprar-creditos">
            Comprar créditos para más respuestas
          </a>
          <a className="btn" href="https://licenses-forms.vercel.app/comprar" target="_blank" rel="noopener">
            O compra el software, pago único
          </a>
        </div>
        <button className="btn ghost-link" onClick={reset}>
          Probar otro formulario
        </button>
      </div>
    );
  }

  return null;
}
