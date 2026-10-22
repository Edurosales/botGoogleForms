import { NextResponse } from "next/server";
import { clearWebSession, getWebUser } from "@/lib/googleAuth";
import { db } from "@/lib/db";

export async function GET() {
  const u = await getWebUser();
  if (!u) return NextResponse.json({ ok: true, user: null });

  // Cliente de pago = tiene créditos comprados o alguna compra pagada: no ve anuncios.
  let hasPaid = u.credits > 0;
  if (!hasPaid) {
    const { count } = await db()
      .from("web_credit_orders")
      .select("id", { count: "exact", head: true })
      .eq("user_id", u.id)
      .eq("status", "paid");
    hasPaid = (count ?? 0) > 0;
  }

  return NextResponse.json({
    ok: true,
    user: { email: u.email, name: u.name, credits: u.credits, freeCredits: u.freeCredits, hasPaid },
  });
}

export async function POST() {
  await clearWebSession();
  return NextResponse.json({ ok: true });
}
