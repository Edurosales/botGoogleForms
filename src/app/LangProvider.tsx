"use client";

import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { DEFAULT_LOCALE, isLocale, LANG_COOKIE, localeFromAcceptLanguage, translate, type Locale, type MsgKey } from "@/lib/i18n";

type Ctx = { locale: Locale; setLocale: (l: Locale) => void; t: (key: MsgKey, vars?: Record<string, string | number>) => string };
const LangContext = createContext<Ctx>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: (key, vars) => translate(DEFAULT_LOCALE, key, vars),
});

const noSubscribe = () => () => {};

/**
 * Idioma ya elegido: la página de un idioma (/en, /pt…), ?lang= en el enlace
 * o la cookie fb_lang (null si nunca eligió).
 */
function readChosen(): Locale | null {
  const seg = window.location.pathname.split("/")[1];
  if (seg && seg !== "es" && isLocale(seg)) return seg;
  const q = new URLSearchParams(window.location.search).get("lang");
  if (isLocale(q)) return q;
  const m = document.cookie.match(new RegExp(`(?:^|; )${LANG_COOKIE}=([a-z]{2})`));
  return m && isLocale(m[1]) ? m[1] : null;
}

function saveChoice(l: Locale) {
  document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=${365 * 86400}; samesite=lax`;
}

/**
 * Idioma de la interfaz. Si la persona no eligió uno, se usa el del país de
 * su conexión (/api/web/geo) o el de su navegador; el botón de idioma lo
 * cambia y lo recuerda un año.
 */
export function LangProvider({ children }: { children: ReactNode }) {
  const chosen = useSyncExternalStore(noSubscribe, readChosen, () => null);
  const [detected, setDetected] = useState<Locale | null>(null);
  const [picked, setPicked] = useState<Locale | null>(null);
  const locale: Locale = picked ?? chosen ?? detected ?? DEFAULT_LOCALE;

  useEffect(() => {
    if (chosen) {
      saveChoice(chosen); // ?lang= de un enlace se recuerda
      return;
    }
    let active = true;
    fetch("/api/web/geo", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!active) return;
        const l = isLocale(d?.locale) ? d.locale : localeFromAcceptLanguage(navigator.languages?.join(",") || navigator.language);
        if (l) setDetected(l);
      })
      .catch(() => {
        const l = localeFromAcceptLanguage(navigator.language);
        if (active && l) setDetected(l);
      });
    return () => {
      active = false;
    };
  }, [chosen]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    saveChoice(l);
    setPicked(l);
  }, []);
  const value = useMemo<Ctx>(() => ({ locale, setLocale, t: (key, vars) => translate(locale, key, vars) }), [locale, setLocale]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): Ctx {
  return useContext(LangContext);
}

/**
 * Texto traducido con etiquetas simples (<b>…</b>, <terms>…</terms>) que se
 * convierten en elementos de React: nunca se inyecta HTML.
 */
export function Rich({ text, tags = {} }: { text: string; tags?: Record<string, (children: ReactNode) => ReactNode> }) {
  const parts: ReactNode[] = [];
  const re = /<(\w+)>(.*?)<\/\1>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(<Fragment key={i++}>{text.slice(last, m.index)}</Fragment>);
    const render = tags[m[1]] ?? (m[1] === "b" ? (c: ReactNode) => <b>{c}</b> : (c: ReactNode) => c);
    parts.push(<Fragment key={i++}>{render(m[2])}</Fragment>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<Fragment key={i++}>{text.slice(last)}</Fragment>);
  return <>{parts}</>;
}
