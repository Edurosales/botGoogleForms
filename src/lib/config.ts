/** Configuración mínima del sitio. Mismo patrón que license-server/src/lib/config.ts. */

export function siteUrl(): string {
  return (process.env.SITE_URL || "http://localhost:3000").replace(/\/+$/, "");
}

export function formatPen(cents: number): string {
  return `S/ ${(cents / 100).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
