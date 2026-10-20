export type Check = { id: string; text: string };

export const WEB_TERMS_VERSION = "2026-10-20";

/** Casillas obligatorias antes de comprar créditos. */
export const CREDIT_PURCHASE_CHECKS: Check[] = [
  {
    id: "formulario_publico",
    text: "Entiendo que los créditos se usan en formularios públicos (sin login) y no se reembolsan si mi formulario deja de estar disponible después de iniciar el envío.",
  },
  {
    id: "no_ilegal",
    text: "El formulario donde use mis créditos no es un concurso, sorteo, votación, elección ni actividad ilegal o regulada.",
  },
  {
    id: "responsabilidad",
    text: "Soy el único responsable del uso de este servicio y de las respuestas generadas.",
  },
];
