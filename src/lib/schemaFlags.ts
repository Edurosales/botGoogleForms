/**
 * Columnas nuevas que pueden no existir todavía si el dueño aún no corrió el
 * SQL de la ronda (supabase/ronda_16.sql). Escribir una columna inexistente
 * hace fallar TODA la actualización (un envío no se crearía o nunca se
 * cerraría), así que se comprueba una vez por instancia y solo se escriben
 * si existen.
 */
import { db } from "./db";

const cache = new Map<string, Promise<boolean>>();

export function hasColumn(table: string, column: string): Promise<boolean> {
  const key = `${table}.${column}`;
  let p = cache.get(key);
  if (!p) {
    p = Promise.resolve(
      db()
        .from(table)
        .select(column)
        .limit(1)
        .then(({ error }) => !error)
    ).catch(() => false);
    cache.set(key, p);
    // Si falta, se vuelve a comprobar en 5 min (por si el dueño corre el SQL).
    p.then((ok) => {
      if (!ok) setTimeout(() => cache.delete(key), 5 * 60_000);
    });
  }
  return p;
}

/** Deja en `patch` solo las columnas opcionales que existen. */
export async function onlyExisting<T extends Record<string, unknown>>(table: string, patch: T, optional: string[]): Promise<T> {
  const out: Record<string, unknown> = { ...patch };
  for (const col of optional) {
    if (col in out && !(await hasColumn(table, col))) delete out[col];
  }
  return out as T;
}
