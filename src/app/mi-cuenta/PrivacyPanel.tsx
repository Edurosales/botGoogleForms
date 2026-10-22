"use client";

import { useState } from "react";
import type { Me } from "../clientData";

/**
 * Mi cuenta → Privacidad y datos: cambiar permisos, descargar todo lo que
 * guardamos y borrar la cuenta (RGPD art. 7.3, 15, 17 y 20).
 */
export default function PrivacyPanel({ me, onChange }: { me: Me; onChange: () => void }) {
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showDelete, setShowDelete] = useState(false);

  async function setPerm(patch: { marketing?: boolean; country?: boolean }) {
    setBusy("perm");
    setMsg("");
    try {
      const r = await fetch("/api/web/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const d = await r.json().catch(() => ({}));
      setMsg(d.ok ? "Guardado." : String(d.error || "No se pudo guardar."));
      if (d.ok) onChange();
    } finally {
      setBusy("");
    }
  }

  async function deleteAccount() {
    setBusy("delete");
    setMsg("");
    try {
      const r = await fetch("/api/web/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmEmail: confirm }),
      });
      const d = await r.json().catch(() => ({}));
      if (d.ok) {
        window.location.href = "/?cuenta=borrada";
        return;
      }
      setMsg(String(d.error || "No se pudo borrar la cuenta."));
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="group privacy" aria-labelledby="privacy-h">
      <h3 id="privacy-h">Privacidad y datos</h3>
      <label className="toggle">
        <input
          type="checkbox"
          checked={me.marketing}
          disabled={busy === "perm"}
          onChange={(e) => setPerm({ marketing: e.target.checked })}
        />
        <span>
          Recibir novedades y ofertas por correo
          <small>Los avisos de tus envíos y compras te llegan igual: son parte del servicio.</small>
        </span>
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={me.countryOptIn}
          disabled={busy === "perm"}
          onChange={(e) => setPerm({ country: e.target.checked })}
        />
        <span>
          Guardar mi país{me.countryOptIn && me.country ? ` (${me.country})` : ""}
          <small>Solo para estadísticas. Si lo desactivas, se borra.</small>
        </span>
      </label>

      <div className="privacy-actions">
        <a className="b b-ghost b-small" href="/api/web/account/export">
          Descargar mis datos
        </a>
        <button type="button" className="b b-ghost b-small b-danger" onClick={() => setShowDelete((v) => !v)}>
          Borrar mi cuenta
        </button>
      </div>

      {showDelete && (
        <div className="note note-err delete-box">
          <p>
            <strong>Esto no se puede deshacer.</strong> Borramos tu correo, nombre, IP, país, tus formularios y las
            respuestas generadas, y pierdes el saldo que tengas. Los pedidos pagados se conservan sin tus datos personales
            porque la ley contable lo exige. Si vuelves a registrarte no recibirás otra vez las respuestas gratis.
          </p>
          <label htmlFor="del-confirm">Escribe tu correo para confirmar</label>
          <input
            id="del-confirm"
            type="email"
            autoComplete="off"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={me.email}
          />
          <button
            type="button"
            className="b b-primary b-danger"
            disabled={busy === "delete" || confirm.trim().toLowerCase() !== me.email.toLowerCase()}
            onClick={deleteAccount}
          >
            {busy === "delete" ? "Borrando…" : "Borrar mi cuenta para siempre"}
          </button>
        </div>
      )}
      {msg && (
        <p className="fine" role="status">
          {msg}
        </p>
      )}
      <p className="fine">
        Más detalles en la <a href="/privacidad.html">política de privacidad</a>. ¿Dudas sobre tus datos? Escríbenos desde el
        botón Soporte.
      </p>
    </section>
  );
}
