import { NextResponse } from "next/server";
import { getWebUser } from "@/lib/googleAuth";
import { db } from "@/lib/db";

const UUID = /^[0-9a-f-]{36}$/i;

/** Notificaciones del usuario + cuántas no leídas. Cada usuario solo ve y toca las suyas. */
export async function GET() {
  const user = await getWebUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const supa = db();
  const [{ data }, { count }] = await Promise.all([
    supa
      .from("web_notifications")
      .select("id,kind,title,body,link,read_at,created_at")
      .eq("audience", "user")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(30),
    supa
      .from("web_notifications")
      .select("id", { count: "exact", head: true })
      .eq("audience", "user")
      .eq("user_id", user.id)
      .is("read_at", null),
  ]);
  return NextResponse.json({ ok: true, items: data ?? [], unread: count ?? 0 });
}

/** PATCH { id } marca una como leída; { all: true } marca todas. */
export async function PATCH(req: Request) {
  const user = await getWebUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { id?: unknown; all?: unknown };
  let q = db()
    .from("web_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("audience", "user")
    .eq("user_id", user.id)
    .is("read_at", null);
  if (b.all !== true) {
    if (typeof b.id !== "string" || !UUID.test(b.id)) return NextResponse.json({ ok: false }, { status: 400 });
    q = q.eq("id", b.id);
  }
  await q;
  return NextResponse.json({ ok: true });
}

/** DELETE ?id= borra una notificación propia. */
export async function DELETE(req: Request) {
  const user = await getWebUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!UUID.test(id)) return NextResponse.json({ ok: false }, { status: 400 });
  await db().from("web_notifications").delete().eq("id", id).eq("audience", "user").eq("user_id", user.id);
  return NextResponse.json({ ok: true });
}
