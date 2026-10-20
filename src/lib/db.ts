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
  status: "queued" | "processing" | "done" | "failed" | "rejected";
  moderation_reason: string;
  created_at: string;
  started_at: string | null;
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
  updated_at: string;
};
