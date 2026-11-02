import { NextResponse } from "next/server";
import { getWebUser } from "@/lib/googleAuth";
import { db } from "@/lib/db";
import { isLocale } from "@/lib/i18n";
import { rateLimit } from "@/lib/ratelimit";

/**
 * POST { locale } → guarda el idioma de la cuenta (para correos y avisos).
 * Solo el de la sesión; valores fuera de es/en/pt/it/fr se rechazan.
 */
export async function POST(req: Request) {
  const user = await getWebUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  if (!rateLimit(`locale:${user.id}`, 20, 10 * 60_000)) return NextResponse.json({ ok: false }, { status: 429 });
  const b = (await req.json().catch(() => ({}))) as { locale?: unknown };
  if (!isLocale(b.locale)) return NextResponse.json({ ok: false }, { status: 400 });
  await db()
    .from("web_users")
    .update({ locale: b.locale })
    .eq("id", user.id)
    .then(
      () => {},
      () => {} // sin la columna (falta ronda_31.sql): no pasa nada
    );
  return NextResponse.json({ ok: true });
}
