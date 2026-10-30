"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useMe, usePublicSettings } from "./clientData";

const noSubscribe = () => () => {};

/**
 * Llegó por /r/CODIGO. Si es nuevo: qué gana al registrarse y comprar. Si ya
 * tiene cuenta: la invitación es solo para cuentas nuevas (y puede invitar él).
 */
export default function InvitedNote() {
  const { referral } = usePublicSettings();
  const { me } = useMe();
  const param = useSyncExternalStore(
    noSubscribe,
    () => new URLSearchParams(window.location.search).get("invitado") ?? "",
    () => ""
  );
  const [closed, setClosed] = useState(false);
  if (!param || closed || !referral || me === undefined) return null;
  const existing = param === "existente" || Boolean(me);
  return (
    <div className={existing ? "invited-note invited-old" : "invited-note"} role="status">
      {existing ? (
        <>
          <p>
            <strong>Esta invitación no es para ti:</strong> solo vale para cuentas nuevas y tú ya tienes cuenta. Igual puedes ganar{" "}
            <strong>{referral.referrerCredits} créditos</strong> por cada amigo que invites.
          </p>
          <Link className="b b-primary b-small" href="/invita">
            Obtener mi enlace
          </Link>
        </>
      ) : (
        <>
          <p>
            <strong>¡Te invitaron!</strong> Crea tu cuenta y en tu primera compra de al menos S/ {(referral.minPurchaseCents / 100).toFixed(2)} recibes{" "}
            <strong>{referral.referredCredits} créditos extra</strong>. <a href="/terminos-herramienta.html#referidos">Condiciones</a>
          </p>
          <a className="b b-primary b-small" href="/mi-cuenta?modo=registro&volver=%2F">
            Crear mi cuenta
          </a>
        </>
      )}
      <button type="button" className="invited-x" aria-label="Cerrar" onClick={() => setClosed(true)}>
        ×
      </button>
    </div>
  );
}
