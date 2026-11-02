"use client";

import { legalHref } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { fmtPen, useMe, usePublicSettings } from "./clientData";
import { Rich, useLang } from "./LangProvider";

/**
 * Regalo flotante en todas las páginas (con sesión iniciada): recuerda que se
 * ganan créditos invitando. Al tocarlo muestra las condiciones. "No mostrar"
 * lo oculta en este navegador.
 */
const HIDE_KEY = "fb-hide-gift";
function readHidden(): boolean {
  try {
    return localStorage.getItem(HIDE_KEY) === "1";
  } catch {
    return false;
  }
}
export default function ReferralFab() {
  const { me } = useMe();
  const { referral } = usePublicSettings();
  const path = usePathname() || "/";
  const { t, locale } = useLang();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(readHidden);
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

  if (!me || !referral || hidden || path.startsWith("/invita")) return null;
  return (
    <div className="gift-fab" ref={box}>
      {open && (
        <div className="gift-pop" role="dialog" aria-label="Invita y gana">
          <button type="button" className="gift-x" aria-label={t("sup.close")} onClick={() => setOpen(false)}>
            ×
          </button>
          <p className="gift-title">
            <Rich text={t("gift.title", { n: referral.referrerCredits })} />
          </p>
          <ul>
            <li>{t("gift.i1", { days: referral.days })}</li>
            <li>{t("gift.i2", { min: fmtPen(referral.minPurchaseCents), a: referral.referrerCredits, b: referral.referredCredits })}</li>
            <li>{t("gift.i3")}</li>
          </ul>
          <Link className="b b-primary b-small" href="/invita">
            {t("gift.cta")}
          </Link>
          <p className="gift-terms">
            <a href={legalHref(locale, "terms", "#referidos")} target="_blank" rel="noopener">
              {t("gift.terms")}
            </a>{" "}
            ·{" "}
            <button
              type="button"
              className="linkish"
              onClick={() => {
                setHidden(true);
                try {
                  localStorage.setItem(HIDE_KEY, "1");
                } catch {
                  /* sin almacenamiento: solo se oculta ahora */
                }
              }}
            >
              {t("gift.hide")}
            </button>
          </p>
        </div>
      )}
      <button type="button" className="gift-btn" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((v) => !v)}>
        <span className="gift-ico" aria-hidden="true">🎁</span>
        <span className="gift-txt">
          <Rich text={t("gift.btn", { n: referral.referrerCredits })} />
        </span>
      </button>
    </div>
  );
}
