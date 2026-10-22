import { NextResponse } from "next/server";
import { getWebUser } from "@/lib/googleAuth";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/ratelimit";

/**
 * Derecho de acceso y portabilidad (RGPD art. 15 y 20): todo lo que
 * guardamos de la cuenta, en JSON descargable.
 */
export async function GET() {
  const user = await getWebUser();
  if (!user) return NextResponse.json({ ok: false, error: "Inicia sesión." }, { status: 401 });
  if (!rateLimit(`export:${user.id}`, 5, 60 * 60_000)) {
    return NextResponse.json({ ok: false, error: "Ya descargaste tus datos varias veces. Intenta en una hora." }, { status: 429 });
  }
  const supa = db();
  const [account, jobs, orders, consents, notifications] = await Promise.all([
    supa.from("web_users").select("*").eq("id", user.id).maybeSingle(),
    supa
      .from("web_jobs")
      .select("id,form_url,title,total,sent,failed,status,is_paid,language,created_at,finished_at,terms_version,terms_accepted_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    supa.from("web_credit_orders").select("*").eq("user_id", user.id),
    supa.from("web_consents").select("kind,granted,version,ip,user_agent,context,created_at").eq("user_id", user.id),
    supa.from("web_notifications").select("kind,title,body,read_at,created_at").eq("user_id", user.id),
  ]);
  const a = (account.data ?? {}) as Record<string, unknown>;
  // Datos internos que no son "sobre la persona" (control de sesión y de baja).
  delete a.session_version;
  delete a.unsubscribe_token;
  await audit({ action: "account.export", userId: user.id, email: user.email });
  const payload = {
    exported_at: new Date().toISOString(),
    service: "FormsBot (bot-google-forms-servicio.vercel.app)",
    account: a,
    jobs: jobs.data ?? [],
    orders: orders.data ?? [],
    consents: consents.data ?? [],
    notifications: notifications.data ?? [],
  };
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="formsbot-mis-datos-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
