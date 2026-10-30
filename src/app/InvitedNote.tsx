"use client";

import { useState, useSyncExternalStore } from "react";
import { useMe, usePublicSettings } from "./clientData";

const noSubscribe = () => () => {};

/** Llegó por /r/CODIGO: le contamos qué gana al registrarse y comprar. */
export default function InvitedNote() {
  const { referral } = usePublicSettings();
  const { me } = useMe();
  const invited = useSyncExternalStore(
    noSubscribe,
    () => new URLSearchParams(window.location.search).get("invitado") === "1",
    () => false
  );
  const [closed, setClosed] = useState(false);
  if (!invited || closed || !referral || me) return null;
  return (
    <div className="invited-note" role="status">
      <p>
        <strong>¡Te invitaron!</strong> Crea tu cuenta y en tu primera compra recibes <strong>{referral.referredCredits} créditos extra</strong>.
      </p>
      <a className="b b-primary b-small" href="/mi-cuenta?modo=registro&volver=%2F">
        Crear mi cuenta
      </a>
      <button type="button" className="invited-x" aria-label="Cerrar" onClick={() => setClosed(true)}>
        ×
      </button>
    </div>
  );
}
