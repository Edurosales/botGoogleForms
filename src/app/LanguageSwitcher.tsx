"use client";

import { useEffect, useRef, useState } from "react";
import { LOCALE_LABEL, LOCALE_SHORT, LOCALES } from "@/lib/i18n";
import { useLang } from "./LangProvider";

/** Botón de idioma (globo + código). En celular ocupa poco; el menú se ancla a la pantalla. */
export default function LanguageSwitcher() {
  const { locale, setLocale, t } = useLang();
  const [open, setOpen] = useState(false);
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

  return (
    <div className="lang" ref={box}>
      <button
        type="button"
        className="lang-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${t("nav.language")}: ${LOCALE_LABEL[locale]}`}
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm6.9 6h-2.95a15.6 15.6 0 0 0-1.38-3.56A8.03 8.03 0 0 1 18.9 8ZM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96ZM4.26 14a8.2 8.2 0 0 1 0-4h3.38a16.5 16.5 0 0 0 0 4H4.26Zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56A8 8 0 0 1 5.08 16Zm2.95-8H5.08a8 8 0 0 1 4.33-3.56A15.6 15.6 0 0 0 8.03 8ZM12 19.96A14 14 0 0 1 10.09 16h3.82A14 14 0 0 1 12 19.96ZM14.34 14H9.66a14.6 14.6 0 0 1 0-4h4.68a14.6 14.6 0 0 1 0 4Zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95a8.03 8.03 0 0 1-4.33 3.56ZM16.36 14a16.5 16.5 0 0 0 0-4h3.38a8.2 8.2 0 0 1 0 4h-3.38Z"
          />
        </svg>
        <span>{LOCALE_SHORT[locale]}</span>
      </button>
      {open && (
        <ul className="lang-menu" role="listbox" aria-label={t("nav.language")}>
          {LOCALES.map((l) => (
            <li key={l}>
              <button
                type="button"
                role="option"
                aria-selected={l === locale}
                className={l === locale ? "on" : ""}
                onClick={() => {
                  setLocale(l);
                  setOpen(false);
                }}
              >
                <b>{LOCALE_SHORT[l]}</b> {LOCALE_LABEL[l]}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
