import { NextResponse } from "next/server";
import { clearWebSession, getWebUser } from "@/lib/googleAuth";

export async function GET() {
  return NextResponse.json({ user: await getWebUser() });
}

export async function POST() {
  await clearWebSession();
  return NextResponse.json({ ok: true });
}
