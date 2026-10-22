import { NextResponse, connection } from "next/server";
import { getWebUser } from "@/lib/googleAuth";
import { getCapacity } from "@/lib/capacity";

/** Capacidad del día (servicio y, con sesión, la cuenta). Para la página de compra y la herramienta. */
export async function GET() {
  await connection();
  const user = await getWebUser().catch(() => null);
  try {
    return NextResponse.json({ ok: true, ...(await getCapacity(user?.id)) });
  } catch (e) {
    console.error("[capacity]", e);
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
