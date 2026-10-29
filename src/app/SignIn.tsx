"use client";

import { useId, useState, useSyncExternalStore } from "react";
import { googleLoginHref, HAS_ACCOUNT_KEY, type LoginChoices } from "./clientData";

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/**
 * Botón "Continuar con Google" con el aspecto de las pautas de marca de
 * Google (blanco, borde gris, logo de color). Si `disabled`, no navega.
 */
export function GoogleButton({
  next,
  choices,
  disabled = false,
  label = "Continuar con Google",
  onNavigate,
}: {
  next: string;
  choices?: LoginChoices;
  disabled?: boolean;
  label?: string;
  onNavigate?: () => void;
}) {
  if (disabled) {
    return (
      <span className="gbtn" aria-disabled="true" role="link">
        <GoogleMark />
        <span>{label}</span>
      </span>
    );
  }
  return (
    <a className="gbtn" href={googleLoginHref(next, choices)} onClick={onNavigate}>
      <GoogleMark />
      <span>{label}</span>
    </a>
  );
}

/** Tarjeta de registro / inicio de sesión: oferta de bienvenida + términos + Google. */
export function SignInCard({
  next,
  freeCredits,
  title = "Crea tu cuenta para enviar",
  compact = false,
  onNavigate,
}: {
  next: string;
  freeCredits: number;
  title?: string;
  compact?: boolean;
  onNavigate?: () => void;
}) {
  const [accepted, setAccepted] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [country, setCountry] = useState(false);
  const checkId = useId();
  // Quien ya tiene cuenta en este navegador entra directo, sin volver a ver
  // las casillas de términos (ya los aceptó al registrarse).
  const knownAccount = useSyncExternalStore(
    noSubscribe,
    () => {
      try {
        return localStorage.getItem(HAS_ACCOUNT_KEY) === "1";
      } catch {
        return false;
      }
    },
    () => false
  );
  const [newAccount, setNewAccount] = useState(false);

  if (knownAccount && !newAccount) {
    return (
      <div className={compact ? "signin signin-compact" : "signin"}>
        <h3>Bienvenido de nuevo</h3>
        <p className="signin-offer">Entra con tu cuenta de Google para seguir.</p>
        <GoogleButton next={next} label="Entrar con Google" onNavigate={onNavigate} />
        <p className="signin-note">
          ¿Vas a usar otra cuenta de Google nueva?{" "}
          <button type="button" className="linkish" onClick={() => setNewAccount(true)}>
            Crear cuenta
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className={compact ? "signin signin-compact" : "signin"}>
      <h3>{title}</h3>
      <p className="signin-offer">
        Tu primera vez: <strong>{freeCredits} respuestas gratis</strong> en modo aleatorio o fijo. Solo pedimos tu
        cuenta de Google, sin contraseña.
      </p>
      <ul className="signin-points">
        <li>Las respuestas gratis son una sola vez por persona.</li>
        <li>Con créditos comprados se activan las respuestas con IA y la fila prioritaria.</li>
      </ul>
      <ConsentChecks
        idPrefix={checkId}
        accepted={accepted}
        setAccepted={setAccepted}
        marketing={marketing}
        setMarketing={setMarketing}
        country={country}
        setCountry={setCountry}
      />
      <GoogleButton next={next} choices={{ terms: accepted, marketing, country }} disabled={!accepted} label="Crear cuenta con Google" onNavigate={onNavigate} />
      {!accepted && <p className="signin-note">Marca la primera casilla para continuar. Las otras dos son opcionales.</p>}
      <p className="signin-note signin-have">
        ¿Ya tienes cuenta?{" "}
        <a href={googleLoginHref(next)} onClick={onNavigate}>
          Entrar con Google
        </a>{" "}
        (no necesitas volver a aceptar).
      </p>
    </div>
  );
}

const noSubscribe = () => () => {};

/**
 * Casillas de consentimiento (estilo RGPD): la primera es obligatoria para
 * crear la cuenta; las opcionales vienen DESMARCADAS y se pueden cambiar
 * cuando quieras en Mi cuenta.
 */
export function ConsentChecks({
  idPrefix,
  accepted,
  setAccepted,
  marketing,
  setMarketing,
  country,
  setCountry,
}: {
  idPrefix: string;
  accepted: boolean;
  setAccepted: (v: boolean) => void;
  marketing: boolean;
  setMarketing: (v: boolean) => void;
  country: boolean;
  setCountry: (v: boolean) => void;
}) {
  return (
    <div className="checks consent-checks">
      <div className="check">
        <input id={`${idPrefix}-t`} type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} required />
        <label htmlFor={`${idPrefix}-t`}>
          <strong>Obligatorio.</strong> Tengo 16 años o más, acepto los{" "}
          <a href="/terminos-herramienta.html" target="_blank" rel="noopener">
            términos del servicio
          </a>{" "}
          y la{" "}
          <a href="/privacidad.html" target="_blank" rel="noopener">
            política de privacidad
          </a>
          , y solo usaré la herramienta con formularios propios o con permiso de su dueño.
        </label>
      </div>
      <div className="check">
        <input id={`${idPrefix}-m`} type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
        <label htmlFor={`${idPrefix}-m`}>
          <strong>Opcional.</strong> Quiero recibir por correo novedades y ofertas de FormsBot. Puedo darme de baja con un
          clic en cualquier correo.
        </label>
      </div>
      <div className="check">
        <input id={`${idPrefix}-c`} type="checkbox" checked={country} onChange={(e) => setCountry(e.target.checked)} />
        <label htmlFor={`${idPrefix}-c`}>
          <strong>Opcional.</strong> Guardar mi país (según mi conexión) para estadísticas del servicio.
        </label>
      </div>
    </div>
  );
}
