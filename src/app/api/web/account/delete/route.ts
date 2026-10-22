import { NextResponse } from "next/server";
import { clearWebSession, emailHash, getWebUser } from "@/lib/googleAuth";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { recordConsent } from "@/lib/consent";
import { notifyAdmin } from "@/lib/notify";

/**
 * Derecho de supresión (RGPD art. 17). No se borra la fila: los pedidos
 * pagados se conservan por obligación contable (art. 17.3.b) y se borrarían
 * en cascada con el usuario. Se ANONIMIZA: correo, nombre, IP, país, Google
 * ID, formularios y respuestas generadas. Queda solo el hash del correo para
 * no regalar de nuevo respuestas gratis (prevención de fraude).
 */
export async function POST(req: Request) {
  const user = await getWebUser();
  if (!user) return NextResponse.json({ ok: false, error: "Inicia sesión." }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { confirmEmail?: unknown };
  if (typeof body.confirmEmail !== "string" || body.confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) {
    return NextResponse.json({ ok: false, error: "Escribe tu correo exacto para confirmar." }, { status: 400 });
  }

  const supa = db();
  const { data: active } = await supa
    .from("web_jobs")
    .select("id")
    .eq("user_id", user.id)
    .in("status", ["queued", "processing"])
    .limit(1);
  if (active?.length) {
    return NextResponse.json(
      { ok: false, error: "Tienes un envío en curso. Espera a que termine para borrar tu cuenta." },
      { status: 409 }
    );
  }

  if (user.marketing) await recordConsent(user, "marketing", false, { via: "account_delete" });
  await audit({ action: "account.delete", level: "security", userId: user.id, email: user.email });

  const { error: hashErr } = await supa.from("web_deleted_accounts").upsert({ email_hash: emailHash(user.email) });
  if (hashErr) {
    // Sin la tabla (SQL de la ronda sin correr) no se borra: no se podría
    // evitar que vuelva a recibir el regalo de bienvenida.
    return NextResponse.json({ ok: false, error: "El borrado aún no está disponible. Escríbenos a soporte." }, { status: 503 });
  }
  const anon = `borrado-${user.id.slice(0, 8)}@cuenta.invalid`;
  const { error } = await supa
    .from("web_users")
    .update({
      email: anon,
      name: "",
      google_sub: `deleted:${user.id}`,
      signup_ip: "",
      credits: 0,
      free_credits: 0,
      marketing_opt_in: false,
      country: null,
      country_opt_in: false,
      unsubscribe_token: null,
      deleted_at: new Date().toISOString(),
    })
    .eq("id", user.id);
  if (error) {
    await audit({ action: "account.delete_failed", level: "error", userId: user.id, details: { error: error.message } });
    return NextResponse.json({ ok: false, error: "No se pudo borrar. Escríbenos a soporte." }, { status: 500 });
  }
  await Promise.all([
    supa
      .from("web_jobs")
      .update({ form_url: "", view_url: "", submit_url: "", title: "", questions: [], profiles: null, custom_instructions: "", q_config: {} })
      .eq("user_id", user.id),
    supa.from("web_notifications").delete().eq("user_id", user.id),
    supa.from("web_consents").update({ email: anon, ip: "", user_agent: "" }).eq("user_id", user.id),
    supa.from("web_audit_log").update({ email: anon, ip: "", user_agent: "" }).eq("user_id", user.id),
  ]);
  await notifyAdmin({
    kind: "account_deleted",
    title: "Cuenta borrada",
    body: `Una persona pidió borrar sus datos (cuenta ${user.id.slice(0, 8)}).`,
    link: "/admin#web-users",
  });
  await clearWebSession();
  return NextResponse.json({ ok: true });
}
