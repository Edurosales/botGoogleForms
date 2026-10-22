"use client";

import { useEffect, useRef } from "react";
import { SUPPORT_EMAIL, SUPPORT_TELEGRAM, usePublicSettings, whatsappLink } from "./clientData";

export type FailCode = "NOT_PUBLIC" | "NEEDS_EMAIL" | "CLOSED" | "REQUIRED" | "VALIDATION" | "RATE_LIMIT" | "NETWORK" | "LOST_TURN" | "OTHER";

export type FailHelpFailure = { index?: number; question?: string; message?: string; hint?: string; code?: string };

/** Qué pasó y cómo se arregla en Google Forms, por cada causa de rechazo. */
const HELP: Record<FailCode, { title: string; why: string; steps: string[] }> = {
  NOT_PUBLIC: {
    title: "Tu formulario no es público",
    why: "Google pide iniciar sesión con una cuenta para responderlo. Cada respuesta tendría que venir de una cuenta real, y eso no se puede simular.",
    steps: [
      "Abre tu formulario en Google Forms (modo edición).",
      "Entra a Configuración → Respuestas.",
      "Desactiva \"Limitar a 1 respuesta\".",
      "Desactiva \"Restringir a usuarios de tu organización\" (si aparece).",
      "En \"Recopilar direcciones de correo\" elige \"Respuesta del usuario\" o \"No recopilar\" (no \"Verificado\").",
      "Si tienes una pregunta de subir archivo, quítala: obliga a iniciar sesión.",
      "Vuelve aquí y envía de nuevo.",
    ],
  },
  NEEDS_EMAIL: {
    title: "Tu formulario pide correo verificado",
    why: "Llenamos el correo con direcciones generadas, pero Google sigue rechazándolo: suele pasar cuando el correo es \"Verificado\" (exige iniciar sesión).",
    steps: [
      "Abre tu formulario en Google Forms → Configuración → Respuestas.",
      "En \"Recopilar direcciones de correo\" elige \"Respuesta del usuario\".",
      "Guarda y vuelve a enviar.",
    ],
  },
  CLOSED: {
    title: "Tu formulario no acepta respuestas",
    why: "El formulario está cerrado: Google rechaza cualquier respuesta nueva.",
    steps: ["Abre tu formulario y ve a la pestaña Respuestas.", "Activa \"Se aceptan respuestas\".", "Vuelve a enviar."],
  },
  REQUIRED: {
    title: "Una pregunta obligatoria quedó vacía",
    why: "Google no acepta la respuesta si falta una pregunta obligatoria.",
    steps: [
      "Pulsa \"Ajustar configuración y reintentar\".",
      "Busca la pregunta que aparece abajo y ponla en Aleatorio, Fijo o Lista.",
      "Vuelve a enviar.",
    ],
  },
  VALIDATION: {
    title: "Una respuesta no cumplió una regla de tu formulario",
    why: "La pregunta tiene una validación (número, largo, formato…) y el valor enviado no la cumplió.",
    steps: [
      "Pulsa \"Ajustar configuración y reintentar\".",
      "En la pregunta indicada usa Fijo o Lista con valores que cumplan la regla (abajo ves el mensaje exacto de Google).",
      "Vuelve a enviar.",
    ],
  },
  RATE_LIMIT: {
    title: "Google frenó los envíos un momento",
    why: "Llegaron muchas respuestas seguidas y Google pidió esperar.",
    steps: ["Espera unos minutos.", "Vuelve a enviar: lo que no llegó ya se te devolvió."],
  },
  NETWORK: {
    title: "No hubo conexión con Google",
    why: "Google tardó demasiado o no respondió. Suele ser algo pasajero.",
    steps: ["Espera unos minutos y vuelve a enviar."],
  },
  LOST_TURN: {
    title: "Perdiste tu turno en la fila",
    why: "La fila gratuita necesita que tu ventana siga abierta. Saliste por más de 10 minutos y el envío se canceló.",
    steps: [
      "Vuelve a enviar tu formulario: te devolvimos tus respuestas gratis.",
      "Deja esta pestaña abierta mientras esperas tu turno.",
      "Con créditos comprados vas en la fila prioritaria y puedes cerrar la pestaña.",
    ],
  },
  OTHER: {
    title: "Google rechazó las respuestas",
    why: "Google no dijo un motivo claro. Suele ser una pregunta obligatoria o una validación de formato.",
    steps: [
      "Pulsa \"Ajustar configuración y reintentar\".",
      "Revisa que cada pregunta tenga un valor válido (abajo ves lo que respondió Google).",
      "Si sigue fallando, escríbenos a soporte con el link de tu formulario.",
    ],
  },
};

export function isFailCode(v: unknown): v is FailCode {
  return typeof v === "string" && v in HELP;
}

export default function FailHelp({
  code,
  failures,
  refundText,
  onRetry,
  onClose,
}: {
  code: FailCode;
  failures: FailHelpFailure[];
  refundText: string;
  onRetry?: () => void;
  onClose: () => void;
}) {
  const settings = usePublicSettings();
  const closeRef = useRef<HTMLButtonElement>(null);
  const help = HELP[code];
  const example = failures.find((f) => f.code === code) ?? failures[failures.length - 1];

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const supportMsg = `Hola, mi envío en FormsBot falló (${help.title}).${example?.message ? ` Google dijo: "${example.message}".` : ""} ¿Me ayudan?`;

  return (
    <div className="paymodal" role="dialog" aria-modal="true" aria-labelledby="fh-title">
      <div className="paymodal-backdrop" onClick={onClose} />
      <div className="paymodal-card fh-card">
        <div className="paymodal-head fh-head">
          <div>
            <p className="paymodal-kicker">Tu envío no se completó</p>
            <h2 id="fh-title">{help.title}</h2>
          </div>
          <button ref={closeRef} type="button" className="paymodal-x" aria-label="Cerrar" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="fh-why">{help.why}</p>
        {example && (example.question || example.message) && (
          <div className="fh-google">
            <p className="fh-label">Lo que respondió Google</p>
            {example.question && <p className="fh-q">Pregunta: “{example.question}”</p>}
            {example.message && <p>{example.message}</p>}
          </div>
        )}
        <p className="fh-label">Cómo arreglarlo</p>
        <ol className="fh-steps">
          {help.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        {refundText && <p className="fh-refund">{refundText}</p>}
        <div className="fh-actions">
          {onRetry && (
            <button type="button" className="b b-primary" onClick={onRetry}>
              Ajustar configuración y reintentar
            </button>
          )}
          <a className="b b-ghost" href={whatsappLink(settings.whatsappNumber, supportMsg)} target="_blank" rel="noopener noreferrer">
            Soporte por WhatsApp
          </a>
        </div>
        <p className="fh-more">
          También por{" "}
          <a href={SUPPORT_TELEGRAM} target="_blank" rel="noopener noreferrer">
            Telegram
          </a>{" "}
          o a <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(help.title)}&body=${encodeURIComponent(supportMsg)}`}>{SUPPORT_EMAIL}</a>.
        </p>
      </div>
    </div>
  );
}
