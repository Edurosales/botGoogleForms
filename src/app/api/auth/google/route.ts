import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { googleAuthUrl, setChoicesCookie, setStateCookie } from "@/lib/googleAuth";
import { decodeChoices, encodeChoices } from "@/lib/consent";

/** Inicia el login con Google. ?next=/ruta vuelve a esa ruta (solo rutas internas). */
export async function GET(req: Request) {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return NextResponse.json({ message: "Google login no configurado (GOOGLE_CLIENT_ID)." }, { status: 500 });
  }
  const next = new URL(req.url).searchParams.get("next") || "/";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const state = `${randomBytes(16).toString("hex")}.${Buffer.from(safeNext).toString("base64url")}`;
  await setStateCookie(state);
  // ?c=TMP (1/0): Términos, novedades por correo (Marketing), guardar País.
  const choices = decodeChoices(new URL(req.url).searchParams.get("c"));
  if (choices) await setChoicesCookie(encodeChoices(choices));
  return NextResponse.redirect(googleAuthUrl(state));
}
