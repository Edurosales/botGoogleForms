"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMe, usePublicSettings } from "./clientData";
import NotificationsBell from "./NotificationsBell";

const LINKS = [
  { href: "/", label: "Herramienta" },
  { href: "/comprar-creditos", label: "Comprar créditos" },
  { href: "/sobre", label: "Sobre FormsBot" },
];

export default function SiteNav() {
  const { me } = useMe();
  const { referral } = usePublicSettings();
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

        <nav className="tn-links" aria-label="Principal">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} aria-current={pathname === l.href ? "page" : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="tn-account">
          {me === undefined && <span className="tn-placeholder" aria-hidden="true" />}

          {me === null && (
            // Dos caminos claros: entrar (sin casillas) o crear cuenta (con términos).
            <div className="tn-auth">
              <a className="tn-login" href={`/mi-cuenta?modo=entrar&volver=${encodeURIComponent(pathname || "/")}`}>
                Iniciar sesión
              </a>
              <a className="tn-signup" href={`/mi-cuenta?modo=registro&volver=${encodeURIComponent(pathname || "/")}`}>
                Registrarse
              </a>
            </div>
          )}

          {me && (
            <>
              <NotificationsBell />
              <Link href="/comprar-creditos" className="tn-balance" title="Créditos comprados y respuestas gratis disponibles">
                <span>
                  <strong>{me.credits}</strong> créditos
                </span>
                {me.freeCredits > 0 && (
                  <span className="tn-balance-free">
                    <strong>{me.freeCredits}</strong> gratis
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
                      <strong>{me.name || "Tu cuenta"}</strong>
                      <span>{me.email}</span>
                    </div>
                    <Link role="menuitem" href="/mi-cuenta" onClick={() => setOpen(false)}>
                      Mi cuenta
                    </Link>
                    <Link role="menuitem" href="/comprar-creditos" onClick={() => setOpen(false)}>
                      Comprar créditos
                    </Link>
                    {referral && (
                      <Link role="menuitem" href="/invita" onClick={() => setOpen(false)}>
                        Invita y gana +{referral.referrerCredits}
                      </Link>
                    )}
                    <button role="menuitem" type="button" onClick={logout} disabled={loggingOut}>
                      {loggingOut ? "Cerrando sesión…" : "Cerrar sesión"}
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
