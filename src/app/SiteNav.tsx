"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMe, usePublicSettings } from "./clientData";
import NotificationsBell from "./NotificationsBell";
import LanguageSwitcher from "./LanguageSwitcher";
import { useLang } from "./LangProvider";
import type { MsgKey } from "@/lib/i18n";

const LINKS: { href: string; label: MsgKey }[] = [
  { href: "/", label: "nav.tool" },
  { href: "/comprar-creditos", label: "nav.buy" },
  { href: "/sobre", label: "nav.about" },
];

export default function SiteNav() {
  const { me } = useMe();
  const { referral } = usePublicSettings();
  const { t, locale } = useLang();
  // "Sobre FormsBot" está en español: en otros idiomas va a su página (/en, /pt…).
  const aboutHref = locale === "es" ? "/sobre" : `/${locale}`;
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function logout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/me", { method: "POST" });
    } finally {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/";
    }
  }

  const initial = me ? (me.name || me.email).trim().charAt(0).toUpperCase() : "";

  return (
    <header className="tn">
      <div className="tn-inner">
        <Link className="tn-logo" href="/">
          Forms<b>Bot</b>
        </Link>

        <nav className="tn-links" aria-label={t("nav.main")} data-app-nav="">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href === "/sobre" ? aboutHref : l.href}
              aria-current={pathname === (l.href === "/sobre" ? aboutHref : l.href) ? "page" : undefined}
            >
              {t(l.label)}
            </Link>
          ))}
        </nav>

        <div className="tn-account">
          <LanguageSwitcher />
          {me === undefined && <span className="tn-placeholder" aria-hidden="true" />}

          {me === null && (
            // Dos caminos claros: entrar (sin casillas) o crear cuenta (con términos).
            <div className="tn-auth">
              <a className="tn-login" href={`/mi-cuenta?modo=entrar&volver=${encodeURIComponent(pathname || "/")}`}>
                {t("nav.login")}
              </a>
              <a className="tn-signup" href={`/mi-cuenta?modo=registro&volver=${encodeURIComponent(pathname || "/")}`}>
                {t("nav.signup")}
              </a>
            </div>
          )}

          {me && (
            <>
              <NotificationsBell />
              <Link href="/comprar-creditos" className="tn-balance" title={t("nav.balanceTitle")}>
                <span>
                  <strong>{me.credits}</strong> {t("nav.credits")}
                </span>
                {me.freeCredits > 0 && (
                  <span className="tn-balance-free">
                    <strong>{me.freeCredits}</strong> {t("nav.free")}
                  </span>
                )}
              </Link>
              <div className="tn-menu" ref={menuRef}>
                <button
                  type="button"
                  className="tn-avatar"
                  aria-haspopup="menu"
                  aria-expanded={open}
                  aria-label={`Cuenta de ${me.email}`}
                  onClick={() => setOpen((v) => !v)}
                >
                  {initial}
                </button>
                {open && (
                  <div className="tn-dropdown" role="menu">
                    <div className="tn-dropdown-who">
                      <strong>{me.name || t("nav.yourAccount")}</strong>
                      <span>{me.email}</span>
                    </div>
                    <Link role="menuitem" href="/mi-cuenta" onClick={() => setOpen(false)}>
                      {t("nav.account")}
                    </Link>
                    <Link role="menuitem" href="/comprar-creditos" onClick={() => setOpen(false)}>
                      {t("nav.buy")}
                    </Link>
                    {referral && (
                      <Link role="menuitem" href="/invita" onClick={() => setOpen(false)}>
                        {t("nav.invite", { n: referral.referrerCredits })}
                      </Link>
                    )}
                    <button role="menuitem" type="button" onClick={logout} disabled={loggingOut}>
                      {loggingOut ? t("nav.loggingOut") : t("nav.logout")}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
