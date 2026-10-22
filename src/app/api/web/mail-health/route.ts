import { NextResponse } from "next/server";
import { gmailConfigured, gmailTokenCheck } from "@/lib/gmail";
import { rateLimit } from "@/lib/ratelimit";
import { requestMeta } from "@/lib/requestMeta";

/**
 * Diagnóstico del correo del SERVICIO (no revela ninguna clave): qué
 * variables ve el despliegue que está corriendo ahora y si Google acepta el
 * refresh token. Sirve para saber si faltó redesplegar tras cargar las
 * variables en Vercel o si están solo en Preview/Development.
 */
export async function GET() {
  const { ip } = await requestMeta();
  if (!rateLimit(`mail-health:${ip}`, 10, 10 * 60_000)) {
    return NextResponse.json({ ok: false, error: "Demasiadas consultas." }, { status: 429 });
  }
  const has = (k: string) => Boolean((process.env[k] || "").trim());
  const vars = {
    GMAIL_REFRESH_TOKEN: has("GMAIL_REFRESH_TOKEN"),
    GMAIL_SENDER: has("GMAIL_SENDER"),
    MAIL_FROM_NAME: has("MAIL_FROM_NAME"),
    GMAIL_CLIENT_ID: has("GMAIL_CLIENT_ID"),
    GOOGLE_CLIENT_ID: has("GOOGLE_CLIENT_ID"),
    WORKER_SECRET: has("WORKER_SECRET"),
  };
  const token = gmailConfigured() ? await gmailTokenCheck() : { ok: false, error: "Faltan variables" };
  return NextResponse.json(
    {
      ok: gmailConfigured() && token.ok,
      deployment: (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7),
      env: process.env.VERCEL_ENV || "",
      vars,
      googleToken: token,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
