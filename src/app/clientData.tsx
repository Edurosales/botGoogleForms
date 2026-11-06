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
  /** Cuenta bloqueada por el admin (motivo); vacío = activa. */
  bannedReason: string;
  purchasesBlockedReason: string;
};

export type PublicSettings = {
  creditPackages: { responses: number; priceCents: number }[];
  whatsappNumber: string;
  buySoftwareUrl: string;
  freeSignupCredits: number;
  maxFreeQuestions: number;
  /** Solo pago: leer y enviar exige créditos. */
  paidOnly: boolean;
  freePaused: boolean;
  /** Medios de pago activos en la tienda (los elige el admin). */
  paymentProviders: ("izipay" | "mercadopago")[];
  /** Mercado Pago pide iniciar sesión en su cuenta para pagar. */
  mpRequiresLogin: boolean;
  purchasesPaused: boolean;
  purchasesPauseMessage: string;
  /** Tira de aviso del admin en todo el sitio. */
  banner: { message: string; kind: "info" | "warn" | "error" } | null;
  maxPaidQuestions: number;
  maxDailyResponses: number;
  dailyPurchaseCap: number;
  /** Programa de referidos (null = apagado). */
  referral: { referrerCredits: number; referredCredits: number; minPurchaseCents: number; days: number } | null;
  /** Saldo por debajo del cual se sugiere recargar (0 = sin aviso). */
  lowCreditsThreshold: number;
};

export const DEFAULT_PUBLIC_SETTINGS: PublicSettings = {
  creditPackages: [],
  whatsappNumber: "51935372306",
  buySoftwareUrl: "https://licenses-forms.vercel.app/comprar",
  freeSignupCredits: 30,
  paidOnly: false,
  freePaused: false,
  maxFreeQuestions: 30,
  paymentProviders: ["izipay"],
  mpRequiresLogin: false,
  purchasesPaused: false,
  purchasesPauseMessage: "",
  banner: null,
  maxPaidQuestions: 60,
  maxDailyResponses: 500,
  dailyPurchaseCap: 500,
  referral: null,
  lowCreditsThreshold: 0,
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
    bannedReason: typeof u.bannedReason === "string" ? u.bannedReason : "",
    purchasesBlockedReason: typeof u.purchasesBlockedReason === "string" ? u.purchasesBlockedReason : "",
  };
}

/** Sesión actual. `undefined` mientras carga, `null` sin sesión. */
export const HAS_ACCOUNT_KEY = "fb-has-account";

// Sesión compartida por toda la página: antes cada componente que la usaba
// (menú, soporte, anuncios, herramienta…) hacía su propia consulta —unas 8 por
// visita, y otras 8 en cada cambio de saldo— y cada una gastaba CPU de Vercel.
// Ahora hay UNA consulta en vuelo a la vez y todos leen el mismo resultado.
let meValue: Me | null | undefined = undefined;
let meAt = 0;
let meInflight: Promise<void> | null = null;
let meListening = false;
// Pedido de refresco que llegó con una consulta en vuelo: se repite al terminar.
let meAgain = false;
const meSubs = new Set<() => void>();
// Al volver a montar (navegar entre páginas) se reutiliza si es reciente.
const ME_FRESH_MS = 60_000;

function loadMe(force = false): Promise<void> {
  if (meInflight) {
    if (force) meAgain = true;
    return meInflight;
  }
  meInflight = fetch("/api/auth/me", { cache: "no-store" })
    .then((r) => r.json())
    .then((d) => {
      const m = normalizeMe(d?.user);
      // Este navegador ya tiene cuenta: al volver a entrar no se piden los términos otra vez.
      if (m) {
        try {
          localStorage.setItem(HAS_ACCOUNT_KEY, "1");
        } catch {}
      }
      meValue = m;
    })
    .catch(() => {
      meValue = null;
    })
    .finally(() => {
      meAt = Date.now();
      meInflight = null;
      meSubs.forEach((f) => f());
      if (meAgain) {
        meAgain = false;
        void loadMe();
      }
    });
  return meInflight;
}

function subscribeMe(cb: () => void) {
  meSubs.add(cb);
  return () => meSubs.delete(cb);
}

export function useMe(): { me: Me | null | undefined; refresh: () => void } {
  const me = useSyncExternalStore(
    subscribeMe,
    () => meValue,
    () => undefined
  );

  useEffect(() => {
    if (meValue === undefined || Date.now() - meAt > ME_FRESH_MS) void loadMe();
    // Un solo oyente para toda la página: un cambio de saldo = una consulta.
    if (!meListening) {
      meListening = true;
      window.addEventListener(BALANCE_EVENT, () => void loadMe(true));
    }
  }, []);

  const refresh = useCallback(() => void loadMe(true), []);
  return { me, refresh };
}

// Configuración pública compartida por toda la página (antes ~7 consultas por
// visita, una por componente). Una consulta en vuelo; se reutiliza 5 min.
let settingsValue: PublicSettings = DEFAULT_PUBLIC_SETTINGS;
let settingsAt = 0;
let settingsInflight: Promise<void> | null = null;
const settingsSubs = new Set<() => void>();
const SETTINGS_FRESH_MS = 5 * 60_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toPublicSettings(d: any): PublicSettings {
  return {
    creditPackages: Array.isArray(d.creditPackages) ? d.creditPackages : DEFAULT_PUBLIC_SETTINGS.creditPackages,
    whatsappNumber: String(d.whatsappNumber || DEFAULT_PUBLIC_SETTINGS.whatsappNumber).replace(/\D/g, ""),
    buySoftwareUrl: safeHttpUrl(d.buySoftwareUrl) || DEFAULT_PUBLIC_SETTINGS.buySoftwareUrl,
    freeSignupCredits: Number.isFinite(Number(d.freeSignupCredits)) ? Number(d.freeSignupCredits) : DEFAULT_PUBLIC_SETTINGS.freeSignupCredits,
    maxFreeQuestions: Number(d.maxFreeQuestions) > 0 ? Number(d.maxFreeQuestions) : DEFAULT_PUBLIC_SETTINGS.maxFreeQuestions,
    paidOnly: d.paidOnly === true,
    freePaused: d.freePaused === true,
    paymentProviders: Array.isArray(d.paymentProviders)
      ? (d.paymentProviders as string[]).filter((p): p is "izipay" | "mercadopago" => p === "izipay" || p === "mercadopago")
      : DEFAULT_PUBLIC_SETTINGS.paymentProviders,
    mpRequiresLogin: d.mpRequiresLogin === true,
    purchasesPaused: d.purchasesPaused === true,
    purchasesPauseMessage: typeof d.purchasesPauseMessage === "string" ? d.purchasesPauseMessage : "",
    banner:
      d.banner && typeof d.banner.message === "string" && d.banner.message
        ? { message: d.banner.message, kind: d.banner.kind === "warn" || d.banner.kind === "error" ? d.banner.kind : "info" }
        : null,
    maxPaidQuestions: Number(d.maxPaidQuestions) || 60,
    maxDailyResponses: Number(d.maxDailyResponses) || 500,
    dailyPurchaseCap: Number(d.dailyPurchaseCap) || 500,
    referral:
      d.referral && typeof d.referral === "object"
        ? {
            referrerCredits: Number(d.referral.referrerCredits) || 0,
            referredCredits: Number(d.referral.referredCredits) || 0,
            minPurchaseCents: Number(d.referral.minPurchaseCents) || 0,
            days: Number(d.referral.days) || 30,
          }
        : null,
    lowCreditsThreshold: Number(d.lowCreditsThreshold) || 0,
  };
}

function loadPublicSettings(): Promise<void> {
  if (settingsInflight) return settingsInflight;
  settingsInflight = fetch("/api/web/settings/public")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (d) settingsValue = toPublicSettings(d);
    })
    .catch(() => {})
    .finally(() => {
      settingsAt = Date.now();
      settingsInflight = null;
      settingsSubs.forEach((f) => f());
    });
  return settingsInflight;
}

export function usePublicSettings(): PublicSettings {
  const settings = useSyncExternalStore(
    (cb) => {
      settingsSubs.add(cb);
      return () => settingsSubs.delete(cb);
    },
    () => settingsValue,
    () => DEFAULT_PUBLIC_SETTINGS
  );
  useEffect(() => {
    if (!settingsAt || Date.now() - settingsAt > SETTINGS_FRESH_MS) void loadPublicSettings();
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

export type DailyLimits = {
  responses: { used: number; max: number; left: number };
  purchases: { bought: number; max: number; left: number };
  maxPaidQuestions: number;
  maxFreeQuestions: number;
  privileged: boolean;
};

/** Contadores del día de la cuenta (respuestas enviadas y créditos comprados en 24 h). */
export function useDailyLimits(enabled: boolean): { limits: DailyLimits | null; reload: () => void } {
  const [limits, setLimits] = useState<DailyLimits | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetch("/api/web/limits", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d?.ok) setLimits(d as DailyLimits);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [enabled, n]);
  useEffect(() => {
    if (!enabled) return;
    window.addEventListener(BALANCE_EVENT, () => setN((x) => x + 1));
  }, [enabled]);
  return { limits, reload: () => setN((x) => x + 1) };
}
