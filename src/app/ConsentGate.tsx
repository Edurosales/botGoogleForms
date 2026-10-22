"use client";

import { useId, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { useMe } from "./clientData";
import { ConsentChecks } from "./SignIn";

const noSubscribe = () => () => {};

/** Mensaje según ?error= del inicio de sesión con Google. */
function useLoginError(): string {
  return useSyncExternalStore(
    noSubscribe,
    () => new URLSearchParams(window.location.search).get("error") ?? "",
    () => ""
  );
}

const LOGIN_ERRORS: Record<string, string> = {
  terminos:
    "Para crear tu cuenta primero marca la casilla de Términos y Privacidad y luego continúa con Google. No guardamos ningún dato tuyo hasta que aceptes.",
  google: "No se pudo iniciar sesión con Google. Intenta de nuevo en un momento.",
  estado: "La sesión de inicio expiró. Vuelve a pulsar Continuar con Google.",
};

/**
 * Cuentas creadas antes de la versión vigente de Términos y Privacidad: deben
 * aceptarlos antes de seguir (la herramienta también lo exige en el servidor).
 * También muestra el aviso cuando Google devolvió un error al entrar.
 */
export default function ConsentGate() {
  const { me, refresh } = useMe();
  const path = usePathname() || "/";
  const loginError = useLoginError();
  const [dismissedError, setDismissedError] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [country, setCountry] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const id = useId();

  const errorText = LOGIN_ERRORS[loginError];
  if (errorText && !dismissedError && !me) {
    return (
      <div className="login-alert" role="alert">
        <p>{errorText}</p>
        <div className="login-alert-actions">
          {loginError === "terminos" && (
            <a className="b b-primary b-small" href={`/mi-cuenta?volver=${encodeURIComponent(path)}`}>
              Crear mi cuenta
            </a>
          )}
          <button type="button" className="b b-ghost b-small" onClick={() => setDismissedError(true)}>
            Cerrar
          </button>
        </div>
      </div>
    );
  }

  if (!me || me.termsOk || path.startsWith("/privacidad") || path.startsWith("/terminos")) return null;

  async function save() {
    if (!accepted || saving) return;
    setSaving(true);
    setError("");
    try {
      const r = await fetch("/api/web/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terms: true, marketing, country }),
      });
      const d = await r.json().catch(() => ({}));
      if (!d.ok) setError(String(d.error || "No se pudo guardar. Intenta de nuevo."));
      else refresh();
    } catch {
      setError("No se pudo conectar. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/me", { method: "POST" }).catch(() => {});
    window.location.href = "/";
  }

  return (
    <div className="paymodal" role="dialog" aria-modal="true" aria-labelledby={`${id}-h`}>
      <div className="paymodal-backdrop" />
      <div className="paymodal-card fh-card">
        <div className="paymodal-head">
          <p className="paymodal-kicker">Antes de seguir</p>
          <h2 id={`${id}-h`}>Actualizamos nuestros Términos y la Privacidad</h2>
        </div>
        <p className="fh-why">
          Ahora te explicamos con más detalle qué datos guardamos, para qué y por cuánto tiempo, y puedes elegir si
          quieres recibir novedades. Léelos y acepta para seguir usando FormsBot.
        </p>
        <ConsentChecks
          idPrefix={id}
          accepted={accepted}
          setAccepted={setAccepted}
          marketing={marketing}
          setMarketing={setMarketing}
          country={country}
          setCountry={setCountry}
        />
        {error && <p className="fh-err">{error}</p>}
        <div className="fh-actions">
          <button type="button" className="b b-primary" disabled={!accepted || saving} onClick={save}>
            {saving ? "Guardando…" : "Aceptar y continuar"}
          </button>
          <button type="button" className="b b-ghost" onClick={logout}>
            No acepto, cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
}
