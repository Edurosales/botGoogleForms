import { NextResponse } from "next/server";
import { getWebUser } from "@/lib/googleAuth";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/ratelimit";
import { SUPPORTED_LANGUAGES } from "@/lib/webConfig";

const MAX_PRESETS = 50;

/** ¿Cliente de pago? (créditos en saldo o alguna compra pagada). */
async function isPremium(userId: string, credits: number): Promise<boolean> {
  if (credits > 0) return true;
  const { count } = await db()
    .from("web_credit_orders")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "paid");
  return (count ?? 0) > 0;
}

function hint(msg: string): string {
  return /does not exist|schema cache/i.test(msg) ? "Las configuraciones guardadas aún no están activas." : "No se pudo completar.";
}

/** GET ?formId= → configuraciones guardadas para ese formulario (y si puede guardar). */
export async function GET(req: Request) {
  const user = await getWebUser();
  if (!user) return NextResponse.json({ ok: false, error: "Inicia sesión." }, { status: 401 });
  const formId = new URL(req.url).searchParams.get("formId") ?? "";
  const premium = await isPremium(user.id, user.credits);
  let q = db()
    .from("web_form_presets")
    .select("id,form_id,form_title,name,total,language,custom_instructions,q_config,updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(MAX_PRESETS);
  if (/^[A-Za-z0-9_-]{10,80}$/.test(formId)) q = q.eq("form_id", formId);
  const { data, error } = await q;
  if (error) return NextResponse.json({ ok: true, premium, presets: [], unavailable: hint(error.message) });
  return NextResponse.json({ ok: true, premium, presets: data ?? [] });
}

/** POST { formId, formTitle, name, total, language, customInstructions, qConfig } → guarda (o reemplaza por nombre). */
export async function POST(req: Request) {
  const user = await getWebUser();
  if (!user) return NextResponse.json({ ok: false, error: "Inicia sesión." }, { status: 401 });
  if (!rateLimit(`presets:${user.id}`, 30, 10 * 60_000)) {
    return NextResponse.json({ ok: false, error: "Demasiados cambios seguidos." }, { status: 429 });
  }
  if (!(await isPremium(user.id, user.credits))) {
    return NextResponse.json(
      { ok: false, code: "PREMIUM_REQUIRED", error: "Guardar configuraciones es para clientes con créditos comprados." },
      { status: 402 }
    );
  }
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const formId = typeof b.formId === "string" && /^[A-Za-z0-9_-]{10,80}$/.test(b.formId) ? b.formId : null;
  const name = typeof b.name === "string" ? b.name.trim().slice(0, 60) : "";
  if (!formId || name.length < 1) return NextResponse.json({ ok: false, error: "Ponle un nombre a la configuración." }, { status: 400 });
  const raw = JSON.stringify(b.qConfig ?? {});
  if (raw.length > 120_000) return NextResponse.json({ ok: false, error: "La configuración es demasiado grande." }, { status: 400 });

  const { count } = await db().from("web_form_presets").select("id", { count: "exact", head: true }).eq("user_id", user.id);
  const row = {
    user_id: user.id,
    form_id: formId,
    form_title: typeof b.formTitle === "string" ? b.formTitle.slice(0, 200) : "",
    name,
    total: Math.min(500, Math.max(1, Math.floor(Number(b.total) || 10))),
    language: SUPPORTED_LANGUAGES.some((l) => l.code === b.language) ? (b.language as string) : SUPPORTED_LANGUAGES[0].code,
    custom_instructions: typeof b.customInstructions === "string" ? b.customInstructions.slice(0, 600) : "",
    q_config: b.qConfig && typeof b.qConfig === "object" && !Array.isArray(b.qConfig) ? b.qConfig : {},
    updated_at: new Date().toISOString(),
  };
  // Reemplazar una con el mismo nombre no cuenta para el máximo.
  const { data: existing } = await db().from("web_form_presets").select("id").eq("user_id", user.id).eq("form_id", formId).eq("name", name).maybeSingle();
  if (!existing && (count ?? 0) >= MAX_PRESETS) {
    return NextResponse.json({ ok: false, error: `Puedes guardar hasta ${MAX_PRESETS} configuraciones. Borra alguna.` }, { status: 400 });
  }
  const { error } = await db().from("web_form_presets").upsert(row, { onConflict: "user_id,form_id,name" });
  if (error) return NextResponse.json({ ok: false, error: hint(error.message) }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** DELETE ?id= → borra una configuración propia. */
export async function DELETE(req: Request) {
  const user = await getWebUser();
  if (!user) return NextResponse.json({ ok: false, error: "Inicia sesión." }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "ID inválido." }, { status: 400 });
  await db().from("web_form_presets").delete().eq("id", id).eq("user_id", user.id);
  return NextResponse.json({ ok: true });
}
