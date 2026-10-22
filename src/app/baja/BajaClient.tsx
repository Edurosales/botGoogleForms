"use client";

import { useState, useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

/** Confirmar la baja con un botón (no al abrir la página: los antivirus de correo abren los enlaces solos). */
export default function BajaClient() {
  const token = useSyncExternalStore(
    noSubscribe,
    () => new URLSearchParams(window.location.search).get("t") ?? "",
    () => ""
  );
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");

  async function unsubscribe() {
    setState("busy");
    try {
      const r = await fetch("/api/web/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ t: token }),
      });
      const d = await r.json().catch(() => ({}));
      setState(d.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="sheet">
      <div className="sheet-body">
        {state === "done" ? (
          <>
            <h2>Listo, te diste de baja</h2>
            <p className="sheet-lead">
              No te enviaremos más novedades ni ofertas. Los avisos de tus envíos y compras siguen llegando porque son
              parte del servicio. Puedes volver a suscribirte cuando quieras en Mi cuenta.
            </p>
          </>
        ) : (
          <>
            <h2>¿Dejar de recibir el boletín?</h2>
            <p className="sheet-lead">Dejarás de recibir novedades y ofertas de FormsBot por correo.</p>
            {state === "error" && (
              <div className="note note-err">
                <p>Ese enlace no es válido. Puedes darte de baja desde Mi cuenta → Privacidad y datos.</p>
              </div>
            )}
            <div className="actions">
              <button type="button" className="b b-primary" onClick={unsubscribe} disabled={!token || state === "busy"}>
                {state === "busy" ? "Dando de baja…" : "Darme de baja"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
