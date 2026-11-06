"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMe, usePublicSettings } from "./clientData";
import NotificationsBell from "./NotificationsBell";
import LanguageSwitcher from "./LanguageSwitcher";
import { useLang } from "./LangProvider";
import type { MsgKey } from "@/lib/i18n";
import Icon, { type IconName } from "./icons";
import { openSupportChat, UNREAD_EVENT } from "./SupportButton";

/** Este navegador tenía sesión: el <head> pone la clase `sess` antes de pintar. */
export const SESSION_HINT_KEY = "fb-sess";

const LINKS: { href: string; label: MsgKey }[] = [
  { href: "/", label: "nav.tool" },
  { href: "/comprar-creditos", label: "nav.buy" },
  { href: "/sobre", label: "nav.about" },
];

export default function SiteNav() {
  const { me } = useMe();
  const { referral } = usePublicSettings();
  const { t, tr, locale } = useLang();
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
      localStorage.removeItem("formsbot_tool_draft");
      localStorage.removeItem(SESSION_HINT_KEY);
      localStorage.removeItem("fb-locale-sent");
    } catch {
      /* sin almacenamiento */
    }
    try {
      await fetch("/api/auth/me", { method: "POST" });
    } finally {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/";
    }
  }

  const initial = me ? (me.name || me.email).trim().charAt(0).toUpperCase() : "";

  // Con sesión: menú lateral en PC y barra inferior en celular. Se dibujan
  // siempre y los muestra la clase `sess` de <html>, que un script del <head>
  // pone ANTES de pintar si este navegador tenía sesión: al recargar, el menú
  // ya está ahí (antes aparecía al final y movía toda la página).
  useEffect(() => {
    if (me === undefined) return;
    document.documentElement.classList.toggle("sess", Boolean(me));
    try {
      if (me) localStorage.setItem(SESSION_HINT_KEY, "1");
      else localStorage.removeItem(SESSION_HINT_KEY);
    } catch {
      /* sin almacenamiento: solo se pierde el aviso previo */
    }
  }, [me]);

  const [unread, setUnread] = useState(0);
  // Menú contraído (solo íconos): se recuerda; el <head> pone la clase antes de pintar.
  const [mini, setMini] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMini(document.documentElement.classList.contains("side-mini")), 0);
    return () => clearTimeout(t);
  }, []);
  function toggleMini() {
    const next = !mini;
    setMini(next);
    document.documentElement.classList.toggle("side-mini", next);
    try {
      localStorage.setItem("fb-side-mini", next ? "1" : "0");
    } catch {
      /* sin almacenamiento: vale para esta visita */
    }
  }
  useEffect(() => {
    const on = (e: Event) => setUnread(Number((e as CustomEvent).detail) || 0);
    window.addEventListener(UNREAD_EVENT, on);
    return () => window.removeEventListener(UNREAD_EVENT, on);
  }, []);

  type Item = { key: string; label: string; icon: IconName; mobile: boolean; href?: string; chat?: true };
  const items: Item[] = [
    { key: "tool", href: "/", label: t("nav.tool"), icon: "tool", mobile: true },
    { key: "buy", href: "/comprar-creditos", label: t("nav.buy"), icon: "card", mobile: false },
    { key: "jobs", href: "/mi-cuenta", label: tr("Mis envíos"), icon: "list", mobile: true },
    // Mensajes abre el chat aquí mismo (no navega: antes no cargaba).
    { key: "chat", chat: true, label: tr("Mensajes"), icon: "message", mobile: true },
    ...(referral ? [{ key: "inv", href: "/invita", label: tr("Invita y gana"), icon: "gift" as IconName, mobile: false }] : []),
    { key: "about", href: aboutHref, label: t("nav.about"), icon: "info", mobile: false },
  ];
  const isHere = (href?: string) => !!href && pathname === href;
  const renderItem = (l: Item, size: number) =>
    l.chat ? (
      <button key={l.key} type="button" onClick={openSupportChat} title={l.label}>
        <Icon name={l.icon} size={size} />
        <span>{l.label}</span>
        {unread > 0 && <b className="nav-badge">{unread > 9 ? "9+" : unread}</b>}
      </button>
    ) : (
      <Link key={l.key} href={l.href as string} aria-current={isHere(l.href) ? "page" : undefined} title={l.label}>
        <Icon name={l.icon} size={size} />
        <span>{l.label}</span>
      </Link>
    );

  return (
    <>
    <aside className="side" aria-label={tr("Navegación de la app")}>
      <div className="side-top">
        <Link className="side-logo" href="/" aria-label="FormsBot">
          <span className="side-logo-full">
            Forms<b>Bot</b>
          </span>
          <span className="side-logo-mini" aria-hidden="true">
            F<b>B</b>
          </span>
        </Link>
        <button type="button" className="side-toggle" onClick={toggleMini} aria-label={mini ? tr("Expandir menú") : tr("Contraer menú")} title={mini ? tr("Expandir menú") : tr("Contraer menú")}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 5h16v14H4zM9 5v14" />
            <path d={mini ? "M13 10l2 2-2 2" : "M16 10l-2 2 2 2"} />
          </svg>
        </button>
      </div>
      <nav>{items.map((l) => renderItem(l, 18))}</nav>
    </aside>
    <nav className="bnav" aria-label={tr("Navegación de la app")}>
      {items.filter((l) => l.mobile).map((l) => renderItem(l, 20))}
      {renderItem({ key: "credits", href: "/comprar-creditos", label: tr("Créditos"), icon: "card", mobile: true }, 20)}
    </nav>
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
    </>
  );
}
