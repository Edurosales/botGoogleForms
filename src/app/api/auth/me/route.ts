import { NextResponse } from "next/server";
import { clearWebSession, getWebUser } from "@/lib/googleAuth";

export async function GET() {
  const u = await getWebUser();
  return NextResponse.json({
    ok: true,
    user: u ? { email: u.email, name: u.name, credits: u.credits, freeCredits: u.freeCredits } : null,
  });
}

export async function POST() {
  await clearWebSession();
  return NextResponse.json({ ok: true });
}
