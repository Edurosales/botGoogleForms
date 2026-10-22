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
  updated_at: string;
};

/** Un envío fallido, con el motivo que dio Google y una sugerencia para arreglarlo. */
export type FailureDetail = {
  index: number;
  status: number;
  question: string;
  message: string;
  hint: string;
};

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
