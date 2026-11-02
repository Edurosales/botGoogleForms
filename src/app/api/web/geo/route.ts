import { NextResponse } from "next/server";
import { localeFromAcceptLanguage, localeFromCountry } from "@/lib/i18n";

/**
 * Idioma sugerido según el país de la conexión (cabecera de Vercel) o, si no
 * se sabe, el idioma del navegador. No guarda nada ni devuelve la IP.
 */
export async function GET(req: Request) {
  const country = (req.headers.get("x-vercel-ip-country") || "").toUpperCase().slice(0, 2);
  // null = no se sabe: el navegador decide con su propio idioma.
  const locale = localeFromCountry(country) ?? localeFromAcceptLanguage(req.headers.get("accept-language"));
  return NextResponse.json({ country, locale }, { headers: { "Cache-Control": "private, no-store" } });
}
