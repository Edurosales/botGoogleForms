/**
 * Idioma de cada cuenta (web_users.locale, ronda_31.sql) para escribir los
 * correos de servicio y los avisos de la campana en ese idioma. Sin la
 * columna, o con un valor raro, se usa español.
 */
import { db } from "./db";
import { DEFAULT_LOCALE, isLocale, trPhrase, type Locale } from "./i18n";

export type Tr = (es: string, vars?: Record<string, string | number>) => string;

export function trFor(locale: Locale): Tr {
  return (es, vars) => trPhrase(locale, es, vars);
}

export function localeOf(row: Record<string, unknown> | null | undefined): Locale {
  const l = row?.locale;
  return isLocale(l) ? l : DEFAULT_LOCALE;
}

export async function getUserLocale(userId: string): Promise<Locale> {
  try {
    const { data } = await db().from("web_users").select("*").eq("id", userId).maybeSingle<Record<string, unknown>>();
    return localeOf(data);
  } catch {
    return DEFAULT_LOCALE;
  }
}

/** Formato de fecha de los correos según el idioma (hora de Lima). */
export const DATE_LOCALE: Record<Locale, string> = { es: "es-PE", en: "en-US", pt: "pt-BR", it: "it-IT", fr: "fr-FR" };
