"use client";

import { usePathname } from "next/navigation";
import { usePublicSettings, whatsappLink } from "./clientData";

/** Botón flotante "Soporte" en todas las páginas (sale de la vista durante el pago). */
export default function SupportButton() {
  const settings = usePublicSettings();
  const path = usePathname() || "/";
  return (
    <a
      className="support-fab"
      href={whatsappLink(settings.whatsappNumber, `Hola, necesito ayuda con FormsBot (página ${path}).`)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Contactar a soporte por WhatsApp"
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 2a10 10 0 0 0-8.7 14.9L2 22l5.3-1.4A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3.1.8.8-3-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3Z"
        />
      </svg>
      <span>Soporte</span>
    </a>
  );
}
