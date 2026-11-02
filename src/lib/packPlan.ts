/**
 * Calculadora de la tienda: la combinación MÁS BARATA de los paquetes que el
 * dueño configuró en el panel (Admin → Configuración) para cubrir N créditos.
 * 1 crédito = 1 respuesta. Se puede comprar el mismo paquete varias veces.
 * Empates: primero la que deja menos créditos de sobra, luego menos compras.
 */
export type Pack = { responses: number; priceCents: number };
export type PackPlan = {
  /** Cuántas veces comprar cada paquete (índice del paquete → veces). */
  items: { index: number; times: number }[];
  credits: number;
  priceCents: number;
  purchases: number;
};

/** Más que esto no se calcula (límite de cuenta y de tiempo de cálculo). */
export const MAX_PLAN_CREDITS = 20_000;

export function cheapestPlan(packs: Pack[], need: number): PackPlan | null {
  const valid = packs.map((p, index) => ({ ...p, index })).filter((p) => p.responses > 0 && p.priceCents > 0);
  const n = Math.min(MAX_PLAN_CREDITS, Math.max(0, Math.floor(need)));
  if (!valid.length) return null;
  if (n === 0) return { items: [], credits: 0, priceCents: 0, purchases: 0 };

  // best[x]: plan más barato que da AL MENOS x créditos.
  type Cell = { cost: number; credits: number; buys: number; pick: number; prev: number };
  const best: Cell[] = new Array(n + 1);
  best[0] = { cost: 0, credits: 0, buys: 0, pick: -1, prev: -1 };
  for (let x = 1; x <= n; x++) {
    let cell: Cell | null = null;
    for (const p of valid) {
      const from = Math.max(0, x - p.responses);
      const b = best[from];
      const cand: Cell = { cost: b.cost + p.priceCents, credits: b.credits + p.responses, buys: b.buys + 1, pick: p.index, prev: from };
      if (
        !cell ||
        cand.cost < cell.cost ||
        (cand.cost === cell.cost && (cand.credits < cell.credits || (cand.credits === cell.credits && cand.buys < cell.buys)))
      ) {
        cell = cand;
      }
    }
    best[x] = cell as Cell;
  }

  const times = new Map<number, number>();
  for (let x = n; x > 0 && best[x].pick >= 0; x = best[x].prev) times.set(best[x].pick, (times.get(best[x].pick) ?? 0) + 1);
  const end = best[n];
  return {
    items: [...times].map(([index, t]) => ({ index, times: t })).sort((a, b) => packs[b.index].responses - packs[a.index].responses),
    credits: end.credits,
    priceCents: end.cost,
    purchases: end.buys,
  };
}
