/** Rate limit en memoria (por instancia). Duplicado de license-server/src/lib/ratelimit.ts. */
const hits = new Map<string, { n: number; reset: number }>();

export function rateLimit(id: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const h = hits.get(id);
  if (!h || h.reset < now) {
    hits.set(id, { n: 1, reset: now + windowMs });
    return true;
  }
  h.n += 1;
  return h.n <= max;
}

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
}
