/** Límites del MVP de la Fase 2 — sin cola ni créditos todavía (ver BITACORA.md). */
export const FREE_TEST_CAP = 5;

export const SUPPORTED_LANGUAGES = [
  { code: "español", label: "Español" },
  { code: "inglés", label: "English" },
  { code: "portugués", label: "Português" },
  { code: "francés", label: "Français" },
] as const;

/** Máximo de preguntas de un formulario para usar respuestas gratis (de bienvenida). */
export const MAX_FREE_QUESTIONS = 30;

/** Máximo de preguntas en el servicio web (con créditos). Más que esto → versión de escritorio. */
export const MAX_PAID_QUESTIONS = 60;

/** Respuestas máximas por envío y por cuenta en 24 h (intentos, incluidos los rechazados por Google). */
export const MAX_RESPONSES_PER_JOB = 500;
export const MAX_RESPONSES_PER_DAY = 500;

/**
 * Tope de respuestas por 24 h para TODO el servicio: protege la cuenta de
 * Vercel y evita que Google trate el tráfico como abuso. Ajustable con la
 * variable de entorno GLOBAL_DAILY_RESPONSES_CAP.
 */
export function globalDailyCap(): number {
  const v = Number(process.env.GLOBAL_DAILY_RESPONSES_CAP);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 20_000;
}

export const DEFAULT_WHATSAPP = "51935372306";
export const DEFAULT_BUY_SOFTWARE_URL = "https://licenses-forms.vercel.app/comprar";
