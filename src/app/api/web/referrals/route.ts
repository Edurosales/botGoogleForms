import { NextResponse } from "next/server";
import { getWebUser } from "@/lib/googleAuth";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/ratelimit";
import { getAppSettings } from "@/lib/appSettings";
import { siteUrl } from "@/lib/config";
import { ensureReferralCode, maskEmail } from "@/lib/referrals";

/**
 * GET → "Invita y gana" de la persona con sesión: su enlace, las reglas
 * vigentes y sus invitados (correos enmascarados). Solo lee lo suyo, por el
 * id de la sesión.
 */
export async function GET() {
  const user = await getWebUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  if (!rateLimit(`referrals:${user.id}`, 30, 60_000)) return NextResponse.json({ ok: false }, { status: 429 });
  const s = await getAppSettings();
  const rules = {
    referrerCredits: s.referral_reward_referrer ?? 20,
    referredCredits: s.referral_reward_referred ?? 10,
    minPurchaseCents: s.referral_min_purchase_cents ?? 1500,
    monthlyCap: s.referral_monthly_cap ?? 20,
    days: s.referral_cookie_days ?? 30,
  };
  if (!s.referral_enabled) return NextResponse.json({ ok: true, enabled: false, rules });

  const code = await ensureReferralCode(user.id);
  if (!code) return NextResponse.json({ ok: true, enabled: false, rules });

  const supa = db();
  const { data } = await supa
    .from("web_referrals")
    .select("referred_id,status,referrer_credits,created_at,rewarded_at")
    .eq("referrer_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);
  type Row = { referred_id: string; status: string; referrer_credits: number; created_at: string; rewarded_at: string | null };
  const rows = (data ?? []) as Row[];
  const { data: people } = rows.length
    ? await supa.from("web_users").select("id,email").in("id", rows.map((r) => r.referred_id))
    : { data: [] };
  const emails = new Map((people ?? []).map((p) => [p.id as string, String(p.email ?? "")]));
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();

  return NextResponse.json({
    ok: true,
    enabled: true,
    code,
    link: `${siteUrl()}/r/${code}`,
    rules,
    stats: {
      registered: rows.filter((r) => r.status !== "rejected").length,
      purchased: rows.filter((r) => r.status === "rewarded" || r.status === "capped").length,
      earned: rows.filter((r) => r.status === "rewarded").reduce((n, r) => n + r.referrer_credits, 0),
      thisMonth: rows.filter((r) => r.status === "rewarded" && r.rewarded_at && Date.parse(r.rewarded_at) >= monthStart).length,
    },
    // Sin el id ni el correo completo del invitado.
    invited: rows.slice(0, 50).map((r) => {
      const e = emails.get(r.referred_id) ?? "";
      return {
        who: e && !e.endsWith(".invalid") ? maskEmail(e) : "Cuenta eliminada",
        status: r.status,
        credits: r.referrer_credits,
        date: r.created_at,
      };
    }),
  });
}
