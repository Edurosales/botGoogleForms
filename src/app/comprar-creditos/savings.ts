/**
 * Ahorro REAL de un paquete: cuánto costarían esas mismas respuestas al
 * precio por respuesta del paquete más caro por unidad (el más chico).
 * Nunca se inventa un "precio antes": el precio tachado es una comparación
 * verdadera y siempre se dice contra qué se compara ("a S/ 0.30 c/u").
 * (Un descuento ficticio es publicidad engañosa: Código del Consumidor, Indecopi.)
 */
export type Pack = { responses: number; priceCents: number };

export function packSavings(packages: Pack[], p: Pack): { baseRateCents: number; refCents: number; percent: number } | null {
  if (packages.length < 2) return null;
  const baseRateCents = Math.max(...packages.map((x) => x.priceCents / x.responses));
  const refCents = Math.round(baseRateCents * p.responses);
  const percent = Math.round((1 - p.priceCents / refCents) * 100);
  // Menos de 3 % no vale la pena mostrarlo (y el paquete base no ahorra nada).
  return percent >= 3 ? { baseRateCents, refCents, percent } : null;
}
