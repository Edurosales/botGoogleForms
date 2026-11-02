"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { fmtPen, useMe, usePublicSettings } from "./clientData";
import { Rich, useLang } from "./LangProvider";

const noSubscribe = () => () => {};

/**
 * Llegó por /r/CODIGO. Si es nuevo: qué gana al registrarse y comprar. Si ya
 * tiene cuenta: la invitación es solo para cuentas nuevas (y puede invitar él).
 */
export default function InvitedNote() {
  const { referral } = usePublicSettings();
  const { me } = useMe();
  const { t } = useLang();
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
            <Rich text={t("inv.old", { n: referral.referrerCredits })} />
          </p>
          <Link className="b b-primary b-small" href="/invita">
            {t("gift.cta")}
          </Link>
        </>
      ) : (
        <>
          <p>
            <Rich text={t("inv.new", { n: referral.referredCredits, min: fmtPen(referral.minPurchaseCents) })} />{" "}
            <a href="/terminos-herramienta.html#referidos">{t("inv.conditions")}</a>
          </p>
          <Link className="b b-primary b-small" href="/mi-cuenta?modo=registro&volver=%2F">
            {t("inv.create")}
          </Link>
        </>
      )}
      <button type="button" className="invited-x" aria-label={t("sup.close")} onClick={() => setClosed(true)}>
        ×
      </button>
    </div>
  );
}
