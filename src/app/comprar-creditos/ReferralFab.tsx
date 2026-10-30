"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { fmtPen, useMe, usePublicSettings } from "../clientData";

/**
 * Regalo flotante en "Comprar créditos": a quien ya compró le recuerda que
 * puede ganar créditos invitando. Al tocarlo muestra las condiciones.
 */
export default function ReferralFab() {
  const { me } = useMe();
  const { referral } = usePublicSettings();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  if (!me || !me.hasPaid || !referral || hidden) return null;
  return (
    <div className="gift-fab" ref={box}>
      {open && (
        <div className="gift-pop" role="dialog" aria-label="Invita y gana">
          <button type="button" className="gift-x" aria-label="Cerrar" onClick={() => setOpen(false)}>
            ×
          </button>
          <p className="gift-title">
            Gana <b>{referral.referrerCredits} créditos</b> por cada amigo
          </p>
          <ul>
            <li>Tu amigo se registra con tu enlace (vale {referral.days} días).</li>
            <li>
              Cuando hace su primera compra de {fmtPen(referral.minPurchaseCents)} o más, tú ganas {referral.referrerCredits} y él {referral.referredCredits}{" "}
              créditos.
            </li>
            <li>Una sola vez por amigo; si la compra se devuelve, el premio se retira.</li>
          </ul>
          <Link className="b b-primary b-small" href="/invita">
            Obtener mi enlace
          </Link>
          <p className="gift-terms">
            <a href="/terminos-herramienta.html#referidos" target="_blank" rel="noopener">
              Términos y condiciones
            </a>{" "}
            ·{" "}
            <button type="button" className="linkish" onClick={() => setHidden(true)}>
              No mostrar
            </button>
          </p>
        </div>
      )}
      <button type="button" className="gift-btn" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((v) => !v)}>
        <span className="gift-ico" aria-hidden="true">🎁</span>
        <span className="gift-txt">
          Gana <b>{referral.referrerCredits}</b> créditos invitando
        </span>
      </button>
    </div>
  );
}
