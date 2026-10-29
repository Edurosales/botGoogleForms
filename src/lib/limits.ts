/**
 * Límites efectivos de una cuenta: los generales (Admin → Configuración) o
 * los de su privilegio por correo (Admin → Privilegios), si tiene uno vigente.
 * Una sola fuente para la herramienta, la tienda y el servidor.
 */
import { db } from "./db";
import { getAppSettings } from "./appSettings";
import { MAX_FREE_QUESTIONS, MAX_PAID_QUESTIONS, MAX_RESPONSES_PER_DAY } from "./webConfig";
import { usage, type UsageRow } from "./capacity";

export type Limits = {
  maxPaidQuestions: number;
  maxFreeQuestions: number;
  maxDailyResponses: number;
  dailyPurchaseCap: number;
  privileged: boolean;
  privilegeExpiresAt: string | null;
};

type Privilege = {
  max_questions: number | null;
  max_daily_responses: number | null;
  daily_purchase_cap: number | null;
  expires_at: string | null;
};

export async function limitsFor(email: string): Promise<Limits> {
  const s = await getAppSettings();
  const base: Limits = {
    maxPaidQuestions: s.max_paid_questions ?? MAX_PAID_QUESTIONS,
    maxFreeQuestions: s.max_free_questions ?? MAX_FREE_QUESTIONS,
    maxDailyResponses: s.max_daily_responses ?? MAX_RESPONSES_PER_DAY,
    dailyPurchaseCap: s.daily_purchase_cap ?? 500,
    privileged: false,
    privilegeExpiresAt: null,
  };
  const { data, error } = await db()
    .from("web_user_privileges")
    .select("max_questions,max_daily_responses,daily_purchase_cap,expires_at")
    .eq("email", email.toLowerCase())
    .maybeSingle<Privilege>();
  if (error || !data) return base;
  if (data.expires_at && Date.parse(data.expires_at) < Date.now()) return base;
  return {
    maxPaidQuestions: data.max_questions ?? base.maxPaidQuestions,
    maxFreeQuestions: base.maxFreeQuestions,
    maxDailyResponses: data.max_daily_responses ?? base.maxDailyResponses,
    dailyPurchaseCap: data.daily_purchase_cap ?? base.dailyPurchaseCap,
    privileged: true,
    privilegeExpiresAt: data.expires_at,
  };
}

/** Respuestas usadas por la cuenta en las últimas 24 h (misma regla que el límite diario). */
export async function responsesUsedToday(userId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data } = await db().from("web_jobs").select("total,sent,failed,status").eq("user_id", userId).gte("created_at", since);
  return usage(data as UsageRow[] | null);
}

/** Créditos comprados (pagados) por la cuenta en las últimas 24 h. */
export async function creditsBoughtToday(userId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data } = await db()
    .from("web_credit_orders")
    .select("credits")
    .eq("user_id", userId)
    .eq("status", "paid")
    .gte("paid_at", since);
  return (data ?? []).reduce((n, r) => n + (Number(r.credits) || 0), 0);
}
