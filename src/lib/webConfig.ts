/** Límites del MVP de la Fase 2 — sin cola ni créditos todavía (ver BITACORA.md). */
export const FREE_TEST_CAP = 5;

export const SUPPORTED_LANGUAGES = [
  { code: "español", label: "Español" },
  { code: "inglés", label: "English" },
  { code: "portugués", label: "Português" },
  { code: "francés", label: "Français" },
  { code: "italiano", label: "Italiano" },
] as const;

/**
 * Cuántas cuentas distintas pueden llenar GRATIS un mismo formulario. Evita
 * que alguien abra varias cuentas (otros dispositivos/correos) para llenar el
 * mismo formulario gratis una y otra vez. Pagados y clientes que ya compraron
 * no tienen este límite.
 */
export const FREE_ACCOUNTS_PER_FORM = 1;

/** Lapsos de envío permitidos (minutos). 0 = lo antes posible. Solo envíos pagados. */
// Ritmos largos (15 min a 1 h) mantenían el servidor ocupado: ahora nunca
// pasan del tope de duración del envío (maxJobMinutes).
export const SPREAD_OPTIONS = [0, 5, 10] as const;

/**
 * Tope de duración de un envío, desde que empieza a procesarse: 5 min para
 * formularios de hasta 25 preguntas y 10 min para los más grandes. Lo que no
 * salga en ese tiempo se corta y se devuelve.
 */
export function maxJobMinutes(questions: number): number {
  return questions <= 25 ? 5 : 10;
}

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
