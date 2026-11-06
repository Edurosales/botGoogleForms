"use client";

import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { DEFAULT_LOCALE, isLocale, LANG_COOKIE, localeFromAcceptLanguage, translate, trPhrase, type Locale, type MsgKey } from "@/lib/i18n";

type Vars = Record<string, string | number>;
type Ctx = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  /** Texto corto por clave (lib/i18n.ts). */
  t: (key: MsgKey, vars?: Vars) => string;
  /** Frase por su texto en español (lib/phrases.ts). */
  tr: (es: string, vars?: Vars) => string;
};
const LangContext = createContext<Ctx>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: (key, vars) => translate(DEFAULT_LOCALE, key, vars),
  tr: (es, vars) => trPhrase(DEFAULT_LOCALE, es, vars),
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
    // El idioma por país se guarda 7 días en este navegador: antes se preguntaba
    // al servidor en CADA página (cada consulta gasta CPU de Vercel).
    const GEO_KEY = "fb-geo";
    const GEO_TTL = 7 * 24 * 3600_000;
    try {
      const saved = JSON.parse(localStorage.getItem(GEO_KEY) || "null") as { l?: string; at?: number } | null;
      if (saved && isLocale(saved.l) && saved.at && Date.now() - saved.at < GEO_TTL) {
        const l = saved.l;
        void Promise.resolve().then(() => active && setDetected(l));
        return () => {
          active = false;
        };
      }
    } catch {
      /* sin almacenamiento: se pregunta al servidor */
    }
    fetch("/api/web/geo", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!active) return;
        const l = isLocale(d?.locale) ? d.locale : localeFromAcceptLanguage(navigator.languages?.join(",") || navigator.language);
        if (l) {
          setDetected(l);
          try {
            localStorage.setItem(GEO_KEY, JSON.stringify({ l, at: Date.now() }));
          } catch {
            /* sin almacenamiento */
          }
        }
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
    // Para que los correos y avisos lleguen en este idioma. Solo con sesión y
    // solo si cambió: antes se enviaba en CADA página, también sin sesión.
    const t = setTimeout(() => {
      try {
        if (localStorage.getItem("fb-sess") !== "1" || localStorage.getItem("fb-locale-sent") === locale) return;
      } catch {
        return;
      }
      fetch("/api/web/account/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale }),
      })
        .then((r) => {
          if (r.ok) localStorage.setItem("fb-locale-sent", locale);
        })
        .catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    saveChoice(l);
    setPicked(l);
  }, []);
  const value = useMemo<Ctx>(
    () => ({ locale, setLocale, t: (key, vars) => translate(locale, key, vars), tr: (es, vars) => trPhrase(locale, es, vars) }),
    [locale, setLocale]
  );
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
