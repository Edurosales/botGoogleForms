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

/** Respuestas máximas por envío. */
export const MAX_RESPONSES_PER_JOB = 1000;

export const DEFAULT_WHATSAPP = "51935372306";
export const DEFAULT_BUY_SOFTWARE_URL = "https://licenses-forms.vercel.app/comprar";
