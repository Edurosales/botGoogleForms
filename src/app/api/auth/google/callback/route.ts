import { NextResponse } from "next/server";
import { completeGoogleLogin, setWebSession, takeStateCookie } from "@/lib/googleAuth";
import { siteUrl } from "@/lib/config";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const saved = await takeStateCookie();
  const fail = (why: string) => NextResponse.redirect(`${siteUrl()}/herramienta?error=${why}`);

  if (!code || !state || !saved || state !== saved) return fail("estado");
  const user = await completeGoogleLogin(code);
  if (!user) return fail("google");

  await setWebSession(user);
  let next = "/herramienta";
  try {
    const decoded = Buffer.from(state.split(".")[1] ?? "", "base64url").toString();
    if (decoded.startsWith("/") && !decoded.startsWith("//")) next = decoded;
  } catch {}
  return NextResponse.redirect(`${siteUrl()}${next}`);
}
