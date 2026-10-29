"use client";

import { SUPPORT_EMAIL, SUPPORT_TELEGRAM, useMe } from "./clientData";

/** Cuenta bloqueada por el admin: se explica el motivo y cómo apelar. */
export default function BannedGate() {
  const { me } = useMe();
  if (!me?.bannedReason) return null;

  async function logout() {
    await fetch("/api/auth/me", { method: "POST" }).catch(() => {});
    window.location.href = "/";
  }

  return (
    <div className="paymodal" role="alertdialog" aria-modal="true" aria-labelledby="ban-h">
      <div className="paymodal-backdrop" />
      <div className="paymodal-card fh-card">
        <div className="paymodal-head">
          <p className="paymodal-kicker">Cuenta bloqueada</p>
          <h2 id="ban-h">No puedes usar FormsBot con esta cuenta</h2>
        </div>
        <div className="fh-google">
          <p className="fh-label">Motivo</p>
          <p>{me.bannedReason}</p>
        </div>
        <p className="fh-why">
          Tus datos siguen protegidos. Si crees que es un error, escríbenos a{" "}
          <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Apelación de cuenta bloqueada")}`}>{SUPPORT_EMAIL}</a> o por{" "}
          <a href={SUPPORT_TELEGRAM} target="_blank" rel="noopener noreferrer">
            Telegram
          </a>
          .
        </p>
        <div className="fh-actions">
          <button type="button" className="b b-ghost" onClick={logout}>
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
}
