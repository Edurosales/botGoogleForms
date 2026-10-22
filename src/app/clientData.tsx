"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

export type Me = {
  email: string;
  name: string;
  credits: number;
  freeCredits: number;
  hasPaid: boolean;
  /** Aceptó la versión vigente de Términos y Privacidad. */
  termsOk: boolean;
  marketing: boolean;
  country: string;
  countryOptIn: boolean;
};

export type PublicSettings = {
  creditPackages: { responses: number; priceCents: number }[];
  whatsappNumber: string;
  buySoftwareUrl: string;
  freeSignupCredits: number;
  maxFreeQuestions: number;
};

export const DEFAULT_PUBLIC_SETTINGS: PublicSettings = {
  creditPackages: [],
  whatsappNumber: "51935372306",
  buySoftwareUrl: "https://licenses-forms.vercel.app/comprar",
  freeSignupCredits: 30,
  maxFreeQuestions: 30,
};

/** Otros componentes disparan este evento cuando cambia el saldo (pago, cupón, envío). */
export const BALANCE_EVENT = "formsbot:balance";

export function announceBalanceChange() {
  window.dispatchEvent(new Event(BALANCE_EVENT));
}

function normalizeMe(raw: unknown): Me | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Record<string, unknown>;
  if (typeof u.email !== "string") return null;
  return {
    email: u.email,
    name: typeof u.name === "string" ? u.name : "",
    credits: Number(u.credits) || 0,
    freeCredits: Number(u.freeCredits ?? u.free_credits) || 0,
    hasPaid: u.hasPaid === true,
    termsOk: u.termsOk !== false,
    marketing: u.marketing === true,
    country: typeof u.country === "string" ? u.country : "",
    countryOptIn: u.countryOptIn === true,
  };
}

/** Sesión actual. `undefined` mientras carga, `null` sin sesión. */
export function useMe(): { me: Me | null | undefined; refresh: () => void } {
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  const refresh = useCallback(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setMe(normalizeMe(d?.user)))
      .catch(() => setMe(null));
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener(BALANCE_EVENT, refresh);
    return () => window.removeEventListener(BALANCE_EVENT, refresh);
  }, [refresh]);

  return { me, refresh };
}

export function usePublicSettings(): PublicSettings {
  const [settings, setSettings] = useState<PublicSettings>(DEFAULT_PUBLIC_SETTINGS);

  useEffect(() => {
    let active = true;
    fetch("/api/web/settings/public")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!active || !d) return;
        setSettings({
          creditPackages: Array.isArray(d.creditPackages) ? d.creditPackages : DEFAULT_PUBLIC_SETTINGS.creditPackages,
          whatsappNumber: String(d.whatsappNumber || DEFAULT_PUBLIC_SETTINGS.whatsappNumber).replace(/\D/g, ""),
          buySoftwareUrl: safeHttpUrl(d.buySoftwareUrl) || DEFAULT_PUBLIC_SETTINGS.buySoftwareUrl,
          freeSignupCredits: Number(d.freeSignupCredits) || DEFAULT_PUBLIC_SETTINGS.freeSignupCredits,
          maxFreeQuestions: Number(d.maxFreeQuestions) || DEFAULT_PUBLIC_SETTINGS.maxFreeQuestions,
        });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  return settings;
}

/** Solo deja pasar http(s) absolutos — evita `javascript:` u otros esquemas en un href que viene del servidor. */
export function safeHttpUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const u = new URL(value.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : "";
  } catch {
    return "";
  }
}

/** Canales de soporte (además del WhatsApp configurable en el admin). */
export const SUPPORT_TELEGRAM = "https://t.me/onPowerTec";
export const SUPPORT_EMAIL = "edroservices@gmail.com";

export function whatsappLink(number: string, message: string): string {
  const digits = number.replace(/\D/g, "") || DEFAULT_PUBLIC_SETTINGS.whatsappNumber;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

export function formatPhone(number: string): string {
  const d = number.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("51")) return `+51 ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
  return `+${d}`;
}

export const fmtPen = (cents: number) =>
  `S/ ${(cents / 100).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Ruta interna segura para volver después de iniciar sesión o pagar. */
export function safeNextPath(value: string | null | undefined, fallback = "/"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  return value;
}

/** Lo que marcó la persona antes de ir a Google (Términos, novedades, país). */
export type LoginChoices = { terms: boolean; marketing: boolean; country: boolean };

export const googleLoginHref = (next: string, c?: LoginChoices) =>
  `/api/auth/google?next=${encodeURIComponent(safeNextPath(next))}${
    c ? `&c=${c.terms ? 1 : 0}${c.marketing ? 1 : 0}${c.country ? 1 : 0}` : ""
  }`;

/** Botón del programa de escritorio. Mientras la venta no abra
 * (NEXT_PUBLIC_SOFTWARE_SALES_OPEN), muestra "Pronto" deshabilitado. */
export function SoftwareButton({ href, className, children }: { href: string; className: string; children: React.ReactNode }) {
  if (process.env.NEXT_PUBLIC_SOFTWARE_SALES_OPEN !== "true") {
    return (
      <span className={`${className} is-soon`} aria-disabled="true">
        Pronto: el programa se está preparando
      </span>
    );
  }
  return (
    <a className={className} href={href} target="_blank" rel="noopener">
      {children}
    </a>
  );
}

const COOKIE_KEY = "formsbot-cookie-consent";
const COOKIE_EVENT = "fb-consent";

function readCookieChoice(): "accepted" | "rejected" | "" {
  try {
    const v = localStorage.getItem(COOKIE_KEY);
    return v === "accepted" || v === "rejected" ? v : "";
  } catch {
    return "";
  }
}

function subscribeCookieChoice(cb: () => void) {
  window.addEventListener(COOKIE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(COOKIE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** Elección del banner de cookies. Sin "Aceptar" no se carga NADA de medición ni de anuncios. */
export function useCookieConsent(): "accepted" | "rejected" | "" {
  return useSyncExternalStore(subscribeCookieChoice, readCookieChoice, () => "");
}
