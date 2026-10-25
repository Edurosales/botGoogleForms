"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { SUPPORTED_LANGUAGES } from "@/lib/webConfig";
import { detectLanguage } from "@/lib/langDetect";
import { SignInCard } from "./SignIn";
import FailHelp, { isFailCode, type FailCode } from "./FailHelp";
import { announceBalanceChange, formatPhone, useMe, usePublicSettings, whatsappLink, SoftwareButton } from "./clientData";
import ExportButton from "./ExportButton";
import LiveQueue from "./LiveQueue";
import { type Mode, type QConf, type QConfMap } from "./QuestionEditors";
import { QuestionControls } from "./QuestionControls";
import PresetsBar from "./PresetsBar";

type Validation = {
  kind?: string;
  type?: string;
  min?: number | string;
  max?: number | string;
  pattern?: string;
  message?: string;
  description?: string;
  text?: string;
};

interface QuestionView {
  entry: string;
  title: string;
  type: number;
  typeName: string;
  options: string[];
  required: boolean;
  validation?: Validation | null;
}

interface FormView {
  /** ID estable del formulario (para configuraciones guardadas). */
  formId?: string | null;
  title: string;
  description: string;
  numSections: number;
  questions: QuestionView[];
}

type Rec = { mode?: Mode; value?: string; reason?: string; prompt?: string };
type Warning = { code: string; message: string };
type Failure = { index?: number; status?: number; question?: string; message?: string; hint?: string; code?: string };

type Step = "input" | "parseError" | "preview" | "queued" | "processing" | "done" | "failed";

type JobState = {
  jobId: string;
  sent: number;
  failed: number;
  total: number;
  queuePosition: number;
  isPaid: boolean;
  failures: Failure[];
  reason: string;
  /** Respuestas ya preparadas (antes de enviarlas a Google). */
  generated?: number;
  /** Causa principal si falló (ventana de ayuda). */
  failCode?: string | null;
};

type SavedDraft = {
  url: string;
  total: number;
  language: string;
  customInstructions: string;
  qConfig: QConfMap;
};

const DRAFT_KEY = "formsbot_tool_draft";
const POLL_MS = 2500;

/** Explicación y arreglo por cada motivo por el que un formulario no se puede leer. */
const PARSE_HELP: Record<string, { title: string; fix: string }> = {
  INVALID_URL: {
    title: "Eso no parece un link de formulario",
    fix: "En Google Forms pulsa Enviar, elige el ícono de enlace y copia el link completo.",
  },
  NOT_GOOGLE_FORM: {
    title: "Solo aceptamos formularios de Google",
    fix: "El link debe empezar con docs.google.com/forms o forms.gle.",
  },
  NOT_PUBLIC: {
    title: "El formulario pide iniciar sesión",
    fix: "En Google Forms ve a Configuración, Respuestas, y desactiva la opción que restringe a usuarios de tu organización o que obliga a iniciar sesión.",
  },
  CLOSED: {
    title: "El formulario no está aceptando respuestas",
    fix: "En la pestaña Respuestas de tu formulario activa Aceptar respuestas y vuelve a intentarlo.",
  },
  NOT_FOUND: {
    title: "No encontramos ese formulario",
    fix: "Puede que se haya borrado o que el link esté incompleto. Cópialo de nuevo desde Google Forms.",
  },
  COLLECTS_EMAIL: {
    title: "El formulario recolecta correos verificados",
    fix: "Ese dato exige una cuenta de Google real por respuesta. En Configuración, Respuestas, cambia Recopilar correos a No recopilar o a Respuesta del usuario.",
  },
  FILE_UPLOAD: {
    title: "El formulario tiene una pregunta para subir archivos",
    fix: "Las preguntas de subir archivo obligan a iniciar sesión con Google. Quítala o haz una copia del formulario sin ella.",
  },
  FETCH_FAILED: {
    title: "Google no respondió",
    fix: "Puede ser algo temporal. Espera unos segundos y vuelve a intentarlo.",
  },
  TOO_MANY_QUESTIONS_WEB: {
    title: "El formulario es demasiado grande para el servicio web",
    fix: "El servicio web llena formularios de hasta 60 preguntas. FormsBot para Windows no tiene límite de preguntas ni de respuestas.",
  },
};

function validationHint(v: Validation | null | undefined): string {
  if (!v) return "";
  const text = v.description || v.message || v.text;
  if (text) return text;
  const hasMin = v.min !== undefined && v.min !== null && v.min !== "";
  const hasMax = v.max !== undefined && v.max !== null && v.max !== "";
  if (hasMin && hasMax) return `Google exige un valor entre ${v.min} y ${v.max}.`;
  if (hasMin) return `Google exige un valor mínimo de ${v.min}.`;
  if (hasMax) return `Google exige un valor máximo de ${v.max}.`;
  if (v.pattern) return "Google valida el formato de esta respuesta.";
  return "";
}

function sanitizeRecs(recs: Record<string, Rec>, questions: QuestionView[], aiAllowed: boolean): QConfMap {
  const out: QConfMap = {};
  for (const q of questions) {
    const r = recs[q.entry];
    let mode: Mode = r?.mode === "ai" || r?.mode === "fixed" || r?.mode === "random" ? r.mode : "random";
    if (mode === "ai" && !aiAllowed) mode = "random";
    if (mode === "fixed" && !(r?.value ?? "").trim()) mode = "random";
    out[q.entry] = { mode, value: mode === "fixed" ? r?.value ?? "" : "", prompt: r?.prompt ?? "" };
  }
  return out;
}

function readDraft(): SavedDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as SavedDraft) : null;
  } catch {
    return null;
  }
}

export default function HerramientaClient({ initialUrl = "", paidOrder = "" }: { initialUrl?: string; paidOrder?: string }) {
  const { me } = useMe();
  const settings = usePublicSettings();

  const [step, setStep] = useState<Step>("input");
  const [url, setUrl] = useState(initialUrl);
  const [analyzing, setAnalyzing] = useState(false);
  const [parseError, setParseError] = useState<{ code: string; reason: string } | null>(null);
  const [form, setForm] = useState<FormView | null>(null);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [recs, setRecs] = useState<Record<string, Rec>>({});
  const [parsedMaxFree, setParsedMaxFree] = useState<number | null>(null);
  const [language, setLanguage] = useState<string>(SUPPORTED_LANGUAGES[0].code);
  const [total, setTotal] = useState(10);
  const [customInstructions, setCustomInstructions] = useState("");
  const [qConfig, setQConfig] = useState<QConfMap>({});
  const [confirmUse, setConfirmUse] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ code: string; reason: string } | null>(null);
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [paidBanner, setPaidBanner] = useState(paidOrder);
  const [job, setJob] = useState<JobState | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [resumedTitle, setResumedTitle] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  /** Idioma detectado en el formulario (para avisar y preseleccionarlo). */
  const [detectedLang, setDetectedLang] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);
  const restoredRef = useRef(false);
  const prevStepRef = useRef(step);

  // Al cambiar de paso la tarjeta se acorta y la página quedaba desplazada
  // abajo (sobre los anuncios). Se lleva la tarjeta a la vista.
  useEffect(() => {
    if (prevStepRef.current === step) return;
    prevStepRef.current = step;
    const sheet = document.querySelector(".tool-page .sheet");
    if (sheet && sheet.getBoundingClientRect().top < 0) sheet.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [step]);

  const aiAllowed = !!me && me.credits >= total;
  const maxFreeQuestions = parsedMaxFree ?? settings.maxFreeQuestions;

  const saveDraft = useCallback(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ url, total, language, customInstructions, qConfig } satisfies SavedDraft));
    } catch {
      /* sin localStorage: se pierde el borrador, aceptable */
    }
  }, [url, total, language, customInstructions, qConfig]);

  // ── Leer un formulario ─────────────────────────────────────────
  const analyze = useCallback(
    async (targetUrl: string, keep: SavedDraft | null = null) => {
      const clean = targetUrl.trim();
      if (!clean) return;
      setAnalyzing(true);
      setParseError(null);
      setNotice(null);
      try {
        const res = await fetch("/api/web/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: clean }),
        });
        const data = await res.json().catch(() => ({}));
        if (!data.ok || !data.form) {
          setParseError({ code: String(data.code || ""), reason: String(data.reason || data.error || "") });
          setStep("parseError");
          return;
        }
        const f = data.form as FormView;
        const nextRecs: Record<string, Rec> = data.recommendations && typeof data.recommendations === "object" ? data.recommendations : {};
        setForm(f);
        setWarnings(Array.isArray(data.warnings) ? data.warnings : []);
        setRecs(nextRecs);
        if (data.limits?.maxFreeQuestions) setParsedMaxFree(Number(data.limits.maxFreeQuestions));
        const detected = detectLanguage([f.title, ...f.questions.map((q) => q.title)]);
        setDetectedLang(detected);
        if (keep) {
          setUrl(keep.url);
          setTotal(keep.total || 10);
          setLanguage(keep.language || detected || SUPPORTED_LANGUAGES[0].code);
          setCustomInstructions(keep.customInstructions || "");
        } else if (detected) {
          setLanguage(detected);
        }
        if (keep?.qConfig) {
          const merged: QConfMap = {};
          const fromRecs = sanitizeRecs(nextRecs, f.questions, true);
          for (const q of f.questions) merged[q.entry] = keep.qConfig[q.entry] ?? fromRecs[q.entry];
          setQConfig(merged);
        } else {
          setQConfig(sanitizeRecs(nextRecs, f.questions, aiAllowed));
        }
        setStep("preview");
      } catch {
        setParseError({ code: "FETCH_FAILED", reason: "" });
        setStep("parseError");
      } finally {
        setAnalyzing(false);
      }
    },
    [aiAllowed]
  );

  // ── Restaurar borrador (al volver de Google o de pagar) o leer ?url= ──
  useEffect(() => {
    if (restoredRef.current || me === undefined) return;
    restoredRef.current = true;
    const draft = me ? readDraft() : null;
    if (draft?.url) {
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* nada */
      }
      // analyze() restaura url, cantidad, idioma y configuración del borrador al terminar de leer.
      queueMicrotask(() => void analyze(draft.url, draft));
    } else if (initialUrl) {
      queueMicrotask(() => void analyze(initialUrl));
    }
  }, [me, initialUrl, analyze]);

  // ── Volvió de pagar: aviso, saldo nuevo, URL limpia ──
  useEffect(() => {
    if (!paidOrder) return;
    announceBalanceChange();
    try {
      window.history.replaceState(null, "", "/");
    } catch {
      /* nada */
    }
  }, [paidOrder]);

  useEffect(() => {
    return () => {
      stoppedRef.current = true;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  // ── Estado del envío ───────────────────────────────────────────
  const applyJobData = useCallback((jobId: string, d: Record<string, unknown>) => {
    setJob((prev) => ({
      jobId,
      sent: Number(d.sent ?? prev?.sent ?? 0),
      failed: Number(d.failed ?? prev?.failed ?? 0),
      total: Number(d.total ?? prev?.total ?? 0),
      queuePosition: Number(d.queuePosition ?? 0),
      isPaid: typeof d.isPaid === "boolean" ? d.isPaid : prev?.isPaid ?? false,
      failures: Array.isArray(d.failures) ? (d.failures as Failure[]) : prev?.failures ?? [],
      reason: typeof d.reason === "string" ? d.reason : prev?.reason ?? "",
      generated: typeof d.generated === "number" ? d.generated : prev?.generated,
      failCode: typeof d.failCode === "string" ? d.failCode : prev?.failCode ?? null,
    }));
    const status = String(d.status || "");
    if (status === "queued") setStep("queued");
    else if (status === "processing") setStep("processing");
    else if (status === "done") {
      setStep("done");
      announceBalanceChange();
      return true;
    } else if (status === "failed" || status === "rejected") {
      setStep("failed");
      // Se abre sola la explicación de qué falló y cómo arreglarlo.
      if (status === "failed") setHelpOpen(true);
      announceBalanceChange();
      return true;
    }
    return false;
  }, []);

  const startPolling = useCallback(
    (jobId: string) => {
      if (pollRef.current) clearTimeout(pollRef.current);
      stoppedRef.current = false;
      let failStreak = 0;

      const tick = async () => {
        if (stoppedRef.current) return;
        let data: Record<string, unknown> = {};
        try {
          const res = await fetch(`/api/web/jobs/${jobId}/tick`, { method: "POST" });
          data = await res.json();
        } catch {
          data = { ok: false };
        }
        if (stoppedRef.current) return;
        if (!data.ok) {
          failStreak++;
          if (failStreak >= 3) {
            stoppedRef.current = true;
            setJob((prev) => (prev ? { ...prev, reason: String(data.reason || data.error || "No se pudo completar el envío.") } : prev));
            setStep("failed");
            return;
          }
          pollRef.current = setTimeout(tick, POLL_MS);
          return;
        }
        failStreak = 0;
        // El siguiente tick solo se programa cuando este terminó, para que nunca haya dos en vuelo.
        if (applyJobData(jobId, data)) {
          stoppedRef.current = true;
          return;
        }
        // En fila la posición llega en vivo por LiveQueue: aquí basta un sondeo lento.
        pollRef.current = setTimeout(tick, data.status === "queued" ? 10_000 : POLL_MS);
      };

      void tick();
    },
    [applyJobData]
  );

  // ── Retomar un envío en curso ──────────────────────────────────
  // Si el cliente cerró la pestaña (o vuelve desde otro dispositivo), el
  // envío siguió en la nube: al volver se busca en el servidor y se muestra
  // su avance real en vez de la pantalla vacía.
  const resumeCheckedRef = useRef(false);
  useEffect(() => {
    if (!me || resumeCheckedRef.current || step !== "input") return;
    resumeCheckedRef.current = true;
    (async () => {
      try {
        const list = await fetch("/api/web/jobs", { cache: "no-store" }).then((r) => r.json());
        const active = (list?.jobs ?? []).find((j: { status?: string }) => j.status === "queued" || j.status === "processing");
        if (!active?.id) return;
        const d = await fetch(`/api/web/jobs/${active.id}`, { cache: "no-store" }).then((r) => r.json());
        if (!d?.ok) return;
        setResumedTitle(String(active.title || d.title || ""));
        applyJobData(String(active.id), d);
        if (d.status === "queued" || d.status === "processing") startPolling(String(active.id));
      } catch {
        /* sin envío que retomar */
      }
    })();
  }, [me, step, applyJobData, startPolling]);

  async function refreshJob() {
    if (!job) return;
    setRefreshing(true);
    try {
      const res = await fetch(`/api/web/jobs/${job.jobId}`, { cache: "no-store" });
      const d = await res.json();
      if (d?.ok) applyJobData(job.jobId, d);
    } catch {
      /* el polling sigue igual */
    } finally {
      setRefreshing(false);
    }
  }

  // ── Configuración ──────────────────────────────────────────────
  // Sin créditos comprados suficientes la IA no está disponible: esas preguntas
  // se tratan como aleatorio (y vuelven a IA solas si luego compra créditos).
  const effectiveQ = useMemo<QConfMap>(() => {
    if (aiAllowed || me === undefined) return qConfig;
    const next: QConfMap = {};
    for (const [k, v] of Object.entries(qConfig)) next[k] = v.mode === "ai" ? { ...v, mode: "random" } : v;
    return next;
  }, [qConfig, aiAllowed, me]);
  const usesAi = useMemo(() => Object.values(effectiveQ).some((c) => c.mode === "ai"), [effectiveQ]);
  const tooManyQuestions = !!form && form.questions.length > maxFreeQuestions;
  const needsPaid = usesAi || tooManyQuestions;
  // El servidor no mezcla saldos: un envío sale entero de las respuestas
  // gratis (si alcanzan y no requiere pago) o entero de los créditos.
  const enough = me ? (!needsPaid && me.freeCredits >= total) || me.credits >= total : false;
  const available = me ? (!needsPaid && me.freeCredits >= total ? me.freeCredits : me.credits) : 0;

  function setQ(entry: string, patch: Partial<QConf>) {
    setQConfig((prev) => {
      const base: QConf = prev[entry] ?? { mode: "random", value: "" };
      return { ...prev, [entry]: { ...base, ...patch } };
    });
  }

  function applyRecommended() {
    if (!form) return;
    setQConfig(sanitizeRecs(recs, form.questions, aiAllowed));
  }

  async function suggestWithAi() {
    if (!form) return;
    setAiSuggesting(true);
    setNotice(null);
    try {
      const res = await fetch("/api/web/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formUrl: url }),
      });
      const d = await res.json().catch(() => ({}));
      if (!d.ok || !d.recommendations) {
        setNotice({ code: String(d.code || "AI_SUGGEST_FAILED"), reason: String(d.reason || d.error || "No se pudieron generar sugerencias ahora.") });
        return;
      }
      const merged = { ...recs, ...(d.recommendations as Record<string, Rec>) };
      setRecs(merged);
      setQConfig(sanitizeRecs(merged, form.questions, aiAllowed));
    } catch {
      setNotice({ code: "AI_SUGGEST_FAILED", reason: "No se pudo conectar con el servidor." });
    } finally {
      setAiSuggesting(false);
    }
  }

  function goBuy() {
    saveDraft();
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/comprar-creditos?volver=1";
  }

  function switchAiToRandom() {
    setQConfig((prev) => {
      const next: QConfMap = {};
      for (const [k, v] of Object.entries(prev)) next[k] = v.mode === "ai" ? { ...v, mode: "random" } : v;
      return next;
    });
    setNotice(null);
  }

  async function handleSend() {
    if (!form || !me || sending) return;
    if (!confirmUse) {
      setNotice({ code: "CONFIRM", reason: "Marca la confirmación de uso para enviar." });
      return;
    }
    setSending(true);
    setNotice(null);
    try {
      const res = await fetch("/api/web/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formUrl: url, total, language, customInstructions, qConfig: effectiveQ, acceptedTerms: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.ok && data.code === "ACTIVE_JOB" && data.activeJobId) {
        // Ya tenía un envío en curso (otra pestaña u otro equipo): se muestra ese.
        const activeId = String(data.activeJobId);
        const d = await fetch(`/api/web/jobs/${activeId}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
        if (d?.ok) {
          setResumedTitle(String(d.title || "tu formulario"));
          applyJobData(activeId, d);
          if (d.status === "queued" || d.status === "processing") startPolling(activeId);
          return;
        }
      }
      if (!data.ok) {
        setNotice({
          code: String(data.code || (data.needsCredits ? "NO_CREDITS" : "SEND_FAILED")),
          reason: String(data.reason || data.error || "No se pudo crear el envío."),
        });
        return;
      }
      announceBalanceChange();
      setJob({
        jobId: String(data.jobId),
        sent: 0,
        failed: 0,
        total,
        queuePosition: Number(data.queuePosition) || 0,
        isPaid: typeof data.isPaid === "boolean" ? data.isPaid : needsPaid || me.freeCredits < total,
        failures: [],
        reason: "",
      });
      setStep(data.status === "queued" ? "queued" : "processing");
      startPolling(String(data.jobId));
    } catch {
      setNotice({ code: "SEND_FAILED", reason: "No se pudo conectar con el servidor." });
    } finally {
      setSending(false);
    }
  }

  function backToConfig() {
    stoppedRef.current = true;
    if (pollRef.current) clearTimeout(pollRef.current);
    setNotice(null);
    setStep(form ? "preview" : "input");
  }

  function startOver() {
    stoppedRef.current = true;
    if (pollRef.current) clearTimeout(pollRef.current);
    setStep("input");
    setUrl("");
    setForm(null);
    setJob(null);
    setNotice(null);
    setParseError(null);
  }

  const waHref = whatsappLink(
    settings.whatsappNumber,
    url ? `Hola, quiero que me ayuden a llenar mi formulario: ${url}. Necesito ${total} respuestas.` : "Hola, quiero que me ayuden a llenar mi formulario."
  );

  // ── Render ─────────────────────────────────────────────────────
  const stepIndex = step === "input" || step === "parseError" ? 0 : step === "preview" ? 1 : step === "queued" || step === "processing" ? 2 : 3;
  const stepsBar = (
    <ol className="stepper" aria-label="Pasos">
      {["Link", "Configurar", "Envío", "Resultado"].map((label, i) => (
        <li key={label} className={i < stepIndex ? "is-done" : i === stepIndex ? "is-now" : ""} aria-current={i === stepIndex ? "step" : undefined}>
          <span className="stepper-n">{i + 1}</span>
          <span className="stepper-l">{label}</span>
        </li>
      ))}
    </ol>
  );

  const banner = paidBanner ? (
    <div className="note note-ok" role="status">
      <p>
        <strong>Pago confirmado.</strong> Tus créditos ya están en tu cuenta y las respuestas con IA quedaron disponibles.
      </p>
      <button type="button" className="note-close" onClick={() => setPaidBanner("")} aria-label="Cerrar aviso">
        ×
      </button>
    </div>
  ) : null;

  const softwarePitch = (
    <aside className="pitch">
      <Image src="/soft.png" alt="Ventana del programa FormsBot para escritorio llenando un Google Form" width={1245} height={847} sizes="(max-width: 700px) 100vw, 640px" />
      <div className="pitch-body">
        <h3>¿Lo usas seguido? Llévate el programa</h3>
        <p>FormsBot para Windows llena formularios sin fila, sin límite de respuestas y con tu propia IA. Pago único.</p>
        <SoftwareButton className="b b-ghost" href={settings.buySoftwareUrl}>
          Ver el software
        </SoftwareButton>
      </div>
    </aside>
  );

  const concierge = (
    <section className="concierge" aria-labelledby="concierge-h">
      <h3 id="concierge-h">¿Prefieres que lo llene yo?</h3>
      <p>Mándame el link y la cantidad por WhatsApp. Antes, revisa que tu formulario cumpla esto:</p>
      <ul>
        <li>Se abre sin iniciar sesión con Google.</li>
        <li>No recolecta correos verificados.</li>
        <li>No tiene preguntas para subir archivos.</li>
        <li>No es un concurso, sorteo ni votación.</li>
      </ul>
      <a className="b b-wa" href={waHref} target="_blank" rel="noopener">
        Escribir por WhatsApp al {formatPhone(settings.whatsappNumber)}
      </a>
    </section>
  );

  // Paso 1 — link
  if (step === "input") {
    return (
      <div className="sheet">
        {banner}
        {stepsBar}
        <form
          className="sheet-body"
          onSubmit={(e) => {
            e.preventDefault();
            void analyze(url);
          }}
        >
          <h2>Pega el link de tu formulario</h2>
          <p className="sheet-lead">Tiene que abrirse sin iniciar sesión. Leemos las preguntas y te mostramos cómo vamos a responderlas antes de enviar nada.</p>
          <div className="field">
            <label htmlFor="form-url">Link de tu Google Form</label>
            <input
              id="form-url"
              type="url"
              inputMode="url"
              autoComplete="off"
              placeholder="https://docs.google.com/forms/d/e/…/viewform"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              maxLength={500}
              required
            />
          </div>
          <button className="b b-primary b-block" type="submit" disabled={!url.trim() || analyzing}>
            {analyzing ? "Leyendo el formulario…" : "Leer formulario"}
          </button>
          <p className="fine">No procesamos concursos, sorteos ni votaciones.</p>
        </form>
      </div>
    );
  }

  // Paso 1 — no se pudo leer
  if (step === "parseError") {
    const help = PARSE_HELP[parseError?.code ?? ""];
    return (
      <div className="sheet">
        {stepsBar}
        <div className="sheet-body">
          <h2>{help?.title ?? "No pudimos leer el formulario"}</h2>
          {parseError?.reason && <p className="sheet-lead">{parseError.reason}</p>}
          <div className="note note-warn">
            <p>
              <strong>Cómo arreglarlo.</strong> {help?.fix ?? "Revisa que el link sea correcto y que el formulario sea público."}
            </p>
          </div>
          <div className="actions">
            <button className="b b-primary" type="button" onClick={() => void analyze(url)} disabled={analyzing}>
              {analyzing ? "Leyendo…" : "Volver a intentar"}
            </button>
            <button className="b b-ghost" type="button" onClick={startOver}>
              Usar otro link
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Paso 2 — configurar
  if (step === "preview" && form) {
    const hasRecs = Object.keys(recs).length > 0;
    return (
      <div className="sheet">
        {banner}
        {stepsBar}
        <div className="sheet-body">
          <h2>{form.title || "Tu formulario"}</h2>
          <p className="sheet-lead">
            {form.questions.length} preguntas{form.numSections > 1 ? ` en ${form.numSections} secciones` : ""}. Elige cuántas respuestas quieres y cómo se llena cada pregunta.
          </p>

          {warnings.length > 0 && (
            <div className="note note-warn">
              {warnings.map((w) => (
                <p key={w.code + w.message}>{w.message}</p>
              ))}
            </div>
          )}

          {tooManyQuestions && !(me && me.credits >= total) && (
            <div className="note note-warn">
              <p>
                <strong>Este formulario tiene {form.questions.length} preguntas.</strong> El plan gratis llega hasta {maxFreeQuestions}. Con créditos comprados puedes enviarlo completo.
              </p>
              <button type="button" className="b b-small" onClick={goBuy}>
                Comprar créditos
              </button>
            </div>
          )}

          <fieldset className="group">
            <legend>Envío</legend>
            <div className="grid-2">
              <div className="field">
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
              <div className="field">
                <label htmlFor="lang">Idioma de las respuestas</label>
                <select id="lang" value={language} onChange={(e) => setLanguage(e.target.value)}>
                  {SUPPORTED_LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
                {detectedLang && (
                  <p className="fine lang-note">
                    {detectedLang === language
                      ? `Detectamos que tu formulario está en ${SUPPORTED_LANGUAGES.find((l) => l.code === detectedLang)?.label ?? detectedLang}: nombres, textos y respuestas con IA saldrán en ese idioma. Puedes cambiarlo.`
                      : `Tu formulario parece estar en ${SUPPORTED_LANGUAGES.find((l) => l.code === detectedLang)?.label ?? detectedLang}, pero elegiste otro idioma para las respuestas.`}
                  </p>
                )}
              </div>
            </div>
            {me && (
              <p className="fine">
                Tienes {me.credits} créditos comprados{me.freeCredits > 0 ? ` y ${me.freeCredits} respuestas gratis` : ""}.
              </p>
            )}
          </fieldset>

          {me && form.formId && (
            <PresetsBar
              formId={form.formId}
              formTitle={form.title}
              current={{ total, language, customInstructions, qConfig: effectiveQ }}
              onApply={(p) => {
                setTotal(p.total);
                setLanguage(p.language);
                setCustomInstructions(p.customInstructions);
                // Solo preguntas que siguen existiendo en el formulario (pudo cambiar).
                setQConfig((prev) => {
                  const next = { ...prev };
                  for (const q of form.questions) if (p.qConfig[q.entry]) next[q.entry] = p.qConfig[q.entry];
                  return next;
                });
              }}
            />
          )}

          <fieldset className="group">
            <legend>Cómo se responde cada pregunta</legend>
            <p className="group-hint">
              Aleatorio y fijo se llenan al instante y no gastan IA. La IA escribe respuestas naturales y necesita créditos comprados
              {aiAllowed ? "." : `: tener al menos ${total} para este envío.`}
            </p>
            <div className="toolbar">
              {hasRecs && (
                <button type="button" className="b b-small b-ghost" onClick={applyRecommended}>
                  Aplicar configuración recomendada
                </button>
              )}
              {me && me.credits > 0 && (
                <button type="button" className="b b-small b-ghost" onClick={suggestWithAi} disabled={aiSuggesting}>
                  {aiSuggesting ? "Pensando sugerencias…" : "Sugerencias con IA"}
                </button>
              )}
            </div>

            <ol className="qlist">
              {form.questions.map((q, i) => {
                const conf = effectiveQ[q.entry] ?? { mode: "random" as Mode, value: "" };
                const rec = recs[q.entry];
                const vHint = validationHint(q.validation);
                const selectId = `mode-${q.entry}`;
                const valueId = `value-${q.entry}`;
                return (
                  <li key={q.entry} className="q">
                    <div className="q-head">
                      <span className="q-n">{i + 1}</span>
                      <div>
                        <p className="q-title">
                          {q.title}
                          {q.required && <span className="q-req" aria-label="obligatoria"> *</span>}
                        </p>
                        <p className="q-type">{q.typeName}</p>
                      </div>
                    </div>
                    <QuestionControls
                      q={q}
                      index={i}
                      conf={conf}
                      aiAllowed={aiAllowed}
                      total={total}
                      onChange={(patch) => setQ(q.entry, patch)}
                    />
                    {vHint && <p className="q-hint q-hint-strong">{vHint}</p>}
                    {rec?.reason && <p className="q-hint">Recomendado: {rec.reason}</p>}
                  </li>
                );
              })}
            </ol>
          </fieldset>

          <fieldset className="group">
            <legend>Perfil de quien responde</legend>
            <p className="group-hint">Opcional. Solo lo usan las preguntas en modo IA.</p>
            <label className="sr" htmlFor="persona">
              Perfil de quien responde
            </label>
            <textarea
              id="persona"
              maxLength={600}
              placeholder="Ej: estudiantes universitarios de 18 a 24 años de Lima"
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
            />
          </fieldset>

          {notice && (
            <div className={notice.code === "CONFIRM" ? "note note-warn" : "note note-err"} role="alert">
              <p>{notice.reason}</p>
              {(notice.code === "NO_CREDITS" ||
                notice.code === "TOO_MANY_QUESTIONS" ||
                notice.code === "AI_REQUIRES_PAID" ||
                notice.code === "FORM_FREE_USED") && (
                <div className="actions">
                  <button type="button" className="b b-small b-primary" onClick={goBuy}>
                    Comprar créditos
                  </button>
                  {notice.code === "AI_REQUIRES_PAID" && (
                    <button type="button" className="b b-small b-ghost" onClick={switchAiToRandom}>
                      Cambiar IA por aleatorio
                    </button>
                  )}
                </div>
              )}
              {(notice.code === "TOO_MANY_QUESTIONS_WEB" || notice.code === "DAILY_LIMIT") && (
                <div className="actions">
                  <SoftwareButton className="b b-small b-primary" href={settings.buySoftwareUrl}>
                    Ver FormsBot para Windows
                  </SoftwareButton>
                </div>
              )}
            </div>
          )}

          <div className="submit-area">
            {me === undefined && <p className="fine">Comprobando tu sesión…</p>}

            {me === null && (
              <SignInCard next="/" freeCredits={settings.freeSignupCredits} title="Inicia sesión para enviar" compact onNavigate={saveDraft} />
            )}

            {me && !enough && (
              <>
                <p className="submit-why">
                  Este envío necesita {total} {needsPaid ? "créditos comprados" : "créditos o respuestas gratis"} y tienes {available}.
                  {needsPaid && usesAi ? " Las preguntas con IA solo usan créditos comprados." : ""}
                </p>
                <button type="button" className="b b-primary b-block" onClick={goBuy}>
                  Comprar créditos y volver aquí
                </button>
              </>
            )}

            {me && enough && (
              <>
                <div className="check">
                  <input id="confirm-use" type="checkbox" checked={confirmUse} onChange={(e) => setConfirmUse(e.target.checked)} />
                  <label htmlFor="confirm-use">
                    El formulario es mío o tengo permiso para probarlo, y no es un concurso ni una votación. Acepto los{" "}
                    <a href="/terminos-herramienta.html" target="_blank" rel="noopener">
                      términos
                    </a>
                    .
                  </label>
                </div>
                <button type="button" className="b b-primary b-block" onClick={handleSend} disabled={sending}>
                  {sending ? "Creando el envío…" : `Enviar ${total} respuestas`}
                </button>
                <p className="fine">
                  {!needsPaid && me.freeCredits >= total
                    ? total < me.freeCredits
                      ? `Es tu envío gratis: hay uno solo por cuenta. Pides ${total} de ${me.freeCredits}; las ${me.freeCredits - total} que no uses se pierden.`
                      : `Es tu envío gratis: hay uno solo por cuenta.`
                    : `Usa ${total} de tus ${me.credits} créditos.`}
                </p>
              </>
            )}

            <button type="button" className="b b-text" onClick={startOver}>
              Usar otro formulario
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Paso 3 — en la fila
  if (step === "queued" && job) {
    return (
      <div className="sheet">
        {stepsBar}
        <div className="sheet-body">
          <LiveQueue
            jobId={job.jobId}
            isPaid={job.isPaid}
            initialPosition={job.queuePosition}
            onState={(d) => applyJobData(job.jobId, d)}
            onBuy={goBuy}
          />

          {softwarePitch}
          {concierge}
        </div>
      </div>
    );
  }

  // Paso 3 — enviando
  if (step === "processing" && job) {
    const done = job.sent + job.failed;
    const generated = job.generated ?? 0;
    const preparing = done === 0 && generated < job.total;
    // La barra cuenta la preparación como el primer 15% para que nunca se vea congelada.
    const pct =
      job.total > 0
        ? preparing
          ? Math.round((generated / job.total) * 15)
          : 15 + Math.round((done / job.total) * 85)
        : 0;
    const left = job.total - done;
    const ratio = job.total > 0 ? done / job.total : 0;
    const stage = preparing
      ? {
          title: "Preparando las respuestas",
          detail:
            generated > 0
              ? `${generated} de ${job.total} listas para enviar.`
              : "Armando cada respuesta según tu configuración.",
        }
      : ratio < 0.5
        ? { title: "Enviando respuestas", detail: "Las respuestas están llegando a tu formulario." }
        : ratio < 0.9
          ? { title: "Ya casi", detail: "Más de la mitad ya está en tu formulario." }
          : { title: "Terminando", detail: "Enviando las últimas respuestas." };
    // ~12 respuestas cada ~5 s mientras envía; la preparación con IA es más lenta.
    const secs = preparing ? Math.ceil((job.total - generated) / 6) * 4 + Math.ceil(left / 12) * 5 : Math.ceil(left / 12) * 5;
    const eta = left > 0 ? (secs < 60 ? `unos ${Math.max(5, secs)} s` : `unos ${Math.ceil(secs / 60)} min`) : "";
    return (
      <div className="sheet">
        {stepsBar}
        <div className="sheet-body">
          {resumedTitle && (
            <div className="note note-ok">
              <p>
                Retomamos tu envío en curso{resumedTitle ? ` de “${resumedTitle}”` : ""}: siguió avanzando mientras no estabas.
              </p>
            </div>
          )}
          <h2>{stage.title}</h2>
          <p className="sheet-lead" aria-live="polite">
            {stage.detail}
          </p>
          <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Avance del envío">
            <span style={{ width: `${pct}%` }} />
          </div>
          <p className="fine center">
            {done} de {job.total} enviadas{job.failed > 0 ? `, ${job.failed} rechazadas` : ""}
            {eta ? `. Quedan ${eta}.` : "."}
          </p>
          <p className="fine center">Puedes cerrar esta pestaña: el envío sigue en la nube y lo verás al volver.</p>
          <div className="actions actions-center">
            <button type="button" className="b b-ghost b-small" onClick={refreshJob} disabled={refreshing}>
              {refreshing ? "Actualizando…" : "Actualizar"}
            </button>
          </div>
          {softwarePitch}
        </div>
      </div>
    );
  }

  // Paso 4 — resultado
  if ((step === "done" || step === "failed") && job) {
    const allFailed = step === "failed" || (job.sent === 0 && job.failed > 0);
    const coded = job.failures.find((f) => isFailCode(f.code));
    const failCode: FailCode = isFailCode(job.failCode) ? job.failCode : isFailCode(coded?.code) ? coded.code : "OTHER";
    const refundText =
      job.sent === 0
        ? job.isPaid
          ? `Te devolvimos los ${job.total} créditos: no se gastó nada.`
          : "Te devolvimos tus respuestas gratis: arregla el formulario y vuelve a intentarlo."
        : job.isPaid && job.total - job.sent > 0
          ? `Te devolvimos ${job.total - job.sent} créditos por las respuestas que no llegaron.`
          : "";
    return (
      <div className="sheet">
        {stepsBar}
        {helpOpen && allFailed && (
          <FailHelp
            code={failCode}
            failures={job.failures}
            refundText={refundText}
            onRetry={
              form
                ? () => {
                    setHelpOpen(false);
                    backToConfig();
                  }
                : undefined
            }
            onClose={() => setHelpOpen(false)}
          />
        )}
        <div className="sheet-body">
          <h2>{allFailed ? "No se pudieron enviar las respuestas" : job.failed > 0 ? "Envío terminado con algunos errores" : "Listo, respuestas enviadas"}</h2>
          <p className="sheet-lead">
            {job.sent} de {job.total} respuestas llegaron a tu formulario{job.failed > 0 ? `; ${job.failed} fueron rechazadas por Google` : ""}.
          </p>
          {job.reason && (
            <div className="note note-err">
              <p>{job.reason}</p>
            </div>
          )}
          {allFailed && (
            <div className="actions actions-center">
              <button type="button" className="b b-ghost b-small" onClick={() => setHelpOpen(true)}>
                Ver cómo arreglarlo
              </button>
            </div>
          )}

          {job.failures.length > 0 && (
            <section className="failures" aria-labelledby="failures-h">
              <h3 id="failures-h">Qué rechazó Google</h3>
              <ul>
                {job.failures.slice(0, 20).map((f, i) => (
                  <li key={i}>
                    <p className="failure-what">
                      {typeof f.index === "number" ? `Respuesta ${f.index}` : "Una respuesta"}
                      {f.question ? `, pregunta "${f.question}"` : ""}
                    </p>
                    {f.message && <p>{f.message}</p>}
                    {f.hint && <p className="failure-hint">{f.hint}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {job.sent > 0 && me && (
            <div className="actions">
              <ExportButton jobId={job.jobId} premium={me.hasPaid} />
            </div>
          )}

          <div className="actions">
            {form && (job.failed > 0 || allFailed) && (
              <button type="button" className="b b-primary" onClick={backToConfig}>
                Ajustar configuración y reintentar
              </button>
            )}
            <button type="button" className={form && (job.failed > 0 || allFailed) ? "b b-ghost" : "b b-primary"} onClick={startOver}>
              Probar otro formulario
            </button>
          </div>

          {softwarePitch}
        </div>
      </div>
    );
  }

  return null;
}
