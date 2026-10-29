import { NextResponse } from "next/server";

/**
 * Tipo de cambio aproximado desde soles (PEN), solo para mostrar al cliente
 * cuánto es en su moneda. Siempre se cobra en PEN. Fuente gratuita y pública
 * (open.er-api.com), guardada 12 h en memoria; si falla, no se muestra tabla.
 */
const CURRENCIES = ["USD", "EUR", "MXN", "COP", "CLP", "ARS", "BOB"] as const;
let cache: { at: number; rates: Record<string, number>; updated: string } | null = null;

export async function GET() {
  if (!cache || Date.now() - cache.at > 12 * 3600_000) {
    try {
      const r = await fetch("https://open.er-api.com/v6/latest/PEN", { cache: "no-store", signal: AbortSignal.timeout(6_000) });
      const d = (await r.json()) as { result?: string; rates?: Record<string, number>; time_last_update_utc?: string };
      if (d.result === "success" && d.rates) {
        const rates: Record<string, number> = {};
        for (const c of CURRENCIES) if (typeof d.rates[c] === "number") rates[c] = d.rates[c];
        cache = { at: Date.now(), rates, updated: d.time_last_update_utc ?? "" };
      }
    } catch {
      // Sin tabla si la fuente no responde: el precio en soles sigue visible.
    }
  }
  return NextResponse.json(
    { ok: Boolean(cache), base: "PEN", rates: cache?.rates ?? {}, updated: cache?.updated ?? "" },
    { headers: { "Cache-Control": "public, max-age=3600" } }
  );
}
