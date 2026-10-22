import { NextResponse } from "next/server";
import { completeGoogleLogin, setWebSession, takeChoicesCookie, takeStateCookie } from "@/lib/googleAuth";
import { decodeChoices } from "@/lib/consent";
import { siteUrl } from "@/lib/config";

function requestIp(req: Request): string {
  const fwd = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  return fwd || (req.headers.get("x-real-ip") ?? "").trim();
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const saved = await takeStateCookie();
  const choices = decodeChoices(await takeChoicesCookie());
  const fail = (why: string) => NextResponse.redirect(`${siteUrl()}/?error=${why}`);

  if (!code || !state || !saved || state !== saved) return fail("estado");
  const result = await completeGoogleLogin(code, requestIp(req), choices);
  if ("error" in result) return fail(result.error === "terms" ? "terminos" : "google");
  const user = result.user;

  await setWebSession(user);
  let next = "/";
  try {
    const decoded = Buffer.from(state.split(".")[1] ?? "", "base64url").toString();
    if (decoded.startsWith("/") && !decoded.startsWith("//") && !decoded.includes("\\")) next = decoded;
  } catch {}
  return NextResponse.redirect(`${siteUrl()}${next}`);
}
