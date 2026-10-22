/**
 * Capacidad diaria: tope de TODO el servicio (app_settings.global_daily_cap,
 * editable desde el admin) y límite por cuenta (500 en 24 h). Lo usan la
 * creación de envíos, la página de compra y el panel.
 */
import { db, type WebJob } from "./db";
import { getAppSettings } from "./appSettings";
import { MAX_RESPONSES_PER_DAY, globalDailyCap } from "./webConfig";
import { izipayTestCredentials } from "./izipay";

export type UsageRow = { total: number; sent: number; failed: number; status: WebJob["status"] };

/** Respuestas "consumidas": los envíos activos cuentan completos; los
 * terminados, por intentos reales contra Google (enviadas + rechazadas). */
export function usage(rows: UsageRow[] | null | undefined): number {
  return (rows ?? []).reduce(
    (acc, r) => acc + (r.status === "queued" || r.status === "processing" ? r.total : r.sent + r.failed),
    0
  );
}

export function since24h(): string {
  return new Date(Date.now() - 24 * 60 * 60_000).toISOString();
}

export async function resolveGlobalCap(): Promise<number> {
  const s = await getAppSettings();
  const v = Number(s.global_daily_cap);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : globalDailyCap();
}

export type Capacity = {
  globalCap: number;
  globalUsed: number;
  globalRemaining: number;
  perUserDaily: number;
  userUsed: number | null;
  userRemaining: number | null;
  testPayments: boolean;
};

export async function getCapacity(userId?: string): Promise<Capacity> {
  const supa = db();
  const since = since24h();
  const [cap, all, mine] = await Promise.all([
    resolveGlobalCap(),
    supa.from("web_jobs").select("total,sent,failed,status").gte("created_at", since),
    userId
      ? supa.from("web_jobs").select("total,sent,failed,status").eq("user_id", userId).gte("created_at", since)
      : Promise.resolve({ data: null }),
  ]);
  const globalUsed = usage(all.data as UsageRow[] | null);
  const userUsed = userId ? usage(mine.data as UsageRow[] | null) : null;
  return {
    globalCap: cap,
    globalUsed,
    globalRemaining: Math.max(0, cap - globalUsed),
    perUserDaily: MAX_RESPONSES_PER_DAY,
    userUsed,
    userRemaining: userUsed === null ? null : Math.max(0, MAX_RESPONSES_PER_DAY - userUsed),
    testPayments: izipayTestCredentials() && process.env.IZIPAY_ALLOW_TEST_PAYMENTS !== "true",
  };
}
