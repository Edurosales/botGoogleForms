import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { QuestionConfigMap } from "./aiProfiles";

let client: SupabaseClient | null = null;

/** Mismo proyecto Supabase que license-server (comparten SUPABASE_URL/SERVICE_KEY). */
export function db(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) throw new Error("Faltan SUPABASE_URL / SUPABASE_SERVICE_KEY");
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}

export type WebUser = {
  id: string;
  google_sub: string;
  email: string;
  name: string;
  credits: number;
  /** Créditos de bienvenida: solo modo aleatorio/fijo, cola gratuita, máx. 30 preguntas. */
  free_credits: number;
  free_grant_used: boolean;
  signup_ip: string;
  created_at: string;
  last_login_at: string;
  /** Sube en cada inicio de sesión: invalida las sesiones anteriores (Ronda 14). */
  session_version?: number;
  // Ronda 16 (consentimientos; ausentes hasta correr ronda_16.sql)
  terms_version?: string | null;
  terms_accepted_at?: string | null;
  marketing_opt_in?: boolean;
  marketing_opt_in_at?: string | null;
  country?: string | null;
  country_opt_in?: boolean;
  unsubscribe_token?: string | null;
  deleted_at?: string | null;
  /** Ronda 22: nombre y apellido de Google (pagos). */
  given_name?: string;
  family_name?: string;
  // Ronda 24: bloqueos (con el motivo que ve la persona)
  banned_at?: string | null;
  ban_reason?: string;
  purchases_blocked?: boolean;
  purchases_block_reason?: string;
};

export type WebJob = {
  id: string;
  user_id: string;
  form_url: string;
  view_url: string;
  submit_url: string;
  title: string;
  num_sections: number;
  questions: unknown[];
  total: number;
  sent: number;
  failed: number;
  language: string;
  custom_instructions: string;
  q_config: QuestionConfigMap;
  profiles: Record<string, string>[] | null;
  is_paid: boolean;
  credits_spent: number;
  free_credits_spent: number;
  failure_details: FailureDetail[];
  status: "queued" | "processing" | "done" | "failed" | "rejected";
  moderation_reason: string;
  created_at: string;
  started_at: string | null;
  /** Último avance real (Ronda 12). Ausente si el schema no se re-ejecutó. */
  progress_at?: string | null;
  tick_lock_until?: string | null;
  finished_at: string | null;
  /** El formulario pide correo ("Respuesta del usuario"): se envía uno generado (Ronda 14). */
  collects_email?: boolean;
  /** Causa principal si el envío falló (ver FailureCode). */
  fail_code?: string | null;
  /** Prioridad manual en la cola (admin); mayor = antes. */
  priority?: number;
  // Ronda 17: fila en vivo
  queue_at?: string | null;
  last_seen_at?: string | null;
  lost_turns?: number;
  /** Ronda 18: hora de cada respuesta enviada (alineada con profiles). */
  response_times?: string[];
  /** Ronda 26: repartir el envío en estos minutos (0 = lo antes posible). */
  spread_minutes?: number;
};

export type AppSettings = {
  id: number;
  credit_packages: { responses: number; priceCents: number }[];
  buy_software_url: string;
  whatsapp_number: string;
  whatsapp_message_template: string;
  free_concurrency: number;
  paid_concurrency: number;
  free_daily_cap: number;
  free_signup_credits: number;
  max_signups_per_ip: number;
  /** Tope diario de respuestas de todo el servicio (Ronda 12). */
  global_daily_cap?: number;
  // Ronda 17: pausa del sistema
  service_paused?: boolean;
  free_paused?: boolean;
  auto_pause_free_at?: number;
  pause_message?: string;
  presence_grace_seconds?: number;
  /** Ronda 19: cuentas que pueden llenar gratis un mismo formulario (0 = sin límite). */
  free_accounts_per_form?: number;
  /** Ronda 20: medio de pago de la tienda. */
  payment_provider?: "izipay" | "mercadopago" | "both";
  /** Ronda 23: Mercado Pago solo con sesión iniciada (wallet_purchase). */
  mp_require_login?: boolean;
  // Ronda 24: límites y avisos configurables desde el panel
  max_paid_questions?: number;
  max_free_questions?: number;
  max_daily_responses?: number;
  daily_purchase_cap?: number;
  purchases_paused?: boolean;
  purchases_pause_message?: string;
  banner_message?: string;
  banner_kind?: "info" | "warn" | "error";
  owner_alert_email?: string;
  // Ronda 29: referidos y aviso de pocos créditos
  referral_enabled?: boolean;
  referral_reward_referrer?: number;
  referral_reward_referred?: number;
  referral_min_purchase_cents?: number;
  referral_monthly_cap?: number;
  low_credits_enabled?: boolean;
  low_credits_threshold?: number;
  updated_at: string;
};

/** Un envío fallido, con el motivo que dio Google y una sugerencia para arreglarlo. */
export type FailureDetail = {
  index: number;
  status: number;
  question: string;
  message: string;
  hint: string;
  code?: FailureCode;
};

/** Causa de un rechazo, para explicarle al cliente cómo arreglarlo. */
export type FailureCode =
  | "NOT_PUBLIC"
  | "NEEDS_EMAIL"
  | "CLOSED"
  | "REQUIRED"
  | "VALIDATION"
  | "RATE_LIMIT"
  | "NETWORK"
  | "OTHER";

export type WebCoupon = {
  id: string;
  code: string;
  description: string;
  credits: number;
  discount_percent: number;
  max_uses: number | null;
  uses: number;
  allowed_email: string | null;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
};
