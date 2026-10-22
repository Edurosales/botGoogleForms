import { NextResponse } from "next/server";
import { getWebUser } from "@/lib/googleAuth";
import { db } from "@/lib/db";

/** Compras de créditos del usuario (para "Mi cuenta"), con el motivo si hubo devolución. */
export async function GET() {
  const user = await getWebUser();
  if (!user) return NextResponse.json({ ok: false, reason: "Inicia sesión." }, { status: 401 });
  const { data } = await db()
    .from("web_credit_orders")
    .select("order_id,credits,amount_cents,status,created_at,paid_at,refunded_at,refund_reason")
    .eq("user_id", user.id)
    .in("status", ["paid", "refunded"])
    .order("created_at", { ascending: false })
    .limit(30);
  return NextResponse.json({ ok: true, orders: data ?? [] });
}
