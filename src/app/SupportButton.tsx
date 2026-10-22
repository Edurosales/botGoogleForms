"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { SUPPORT_EMAIL, SUPPORT_TELEGRAM, usePublicSettings, whatsappLink } from "./clientData";

/** Botón flotante "Soporte" en todas las páginas: WhatsApp, Telegram o correo. */
export default function SupportButton() {
  const settings = usePublicSettings();
  const path = usePathname() || "/";
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

  const msg = `Hola, necesito ayuda con FormsBot (página ${path}).`;
  return (
    <div className="support" ref={box}>
      {open && (
        <div className="support-menu" role="menu">
          <p>¿Cómo prefieres que te ayudemos?</p>
          <a role="menuitem" href={whatsappLink(settings.whatsappNumber, msg)} target="_blank" rel="noopener noreferrer">
            <span className="sm-ico sm-wa" aria-hidden="true">W</span> WhatsApp
          </a>
          <a role="menuitem" href={SUPPORT_TELEGRAM} target="_blank" rel="noopener noreferrer">
            <span className="sm-ico sm-tg" aria-hidden="true">T</span> Telegram
          </a>
          <a role="menuitem" href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Ayuda con FormsBot")}&body=${encodeURIComponent(msg)}`}>
            <span className="sm-ico sm-mail" aria-hidden="true">@</span> {SUPPORT_EMAIL}
          </a>
        </div>
      )}
      <button
        type="button"
        className="support-fab"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Contactar a soporte"
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 2C6.5 2 2 6 2 11c0 2.6 1.2 4.9 3.2 6.6L4.5 22l4.3-2.2c1 .3 2.1.4 3.2.4 5.5 0 10-4 10-9S17.5 2 12 2Zm-4 10.3a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6Zm4 0a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6Zm4 0a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6Z"
          />
        </svg>
        <span>Soporte</span>
      </button>
    </div>
  );
}
