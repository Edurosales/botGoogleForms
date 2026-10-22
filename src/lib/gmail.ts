/**
 * Envío de correo con la API de Gmail (OAuth2 con refresh token), igual que
 * license-server/src/lib/gmail.ts. Sin dependencias externas.
 *
 * Variables (Vercel): GMAIL_REFRESH_TOKEN (scope gmail.send), GMAIL_SENDER,
 * MAIL_FROM_NAME. El refresh token pertenece al cliente OAuth que lo emitió:
 * si no es el mismo del login de este sitio, poner GMAIL_CLIENT_ID y
 * GMAIL_CLIENT_SECRET (si no, se usan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).
 */

function env(name: string): string {
  return (process.env[name] || "").trim().replace(/^["']|["']$/g, "");
}

export function gmailConfigured(): boolean {
  return Boolean(env("GMAIL_REFRESH_TOKEN") && (env("GMAIL_CLIENT_ID") || env("GOOGLE_CLIENT_ID")));
}

let cached: { token: string; until: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.until > Date.now()) return cached.token;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("GMAIL_CLIENT_ID") || env("GOOGLE_CLIENT_ID"),
      client_secret: env("GMAIL_CLIENT_SECRET") || env("GOOGLE_CLIENT_SECRET"),
      refresh_token: env("GMAIL_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!j.access_token) {
    if (j.error === "invalid_grant") throw new Error("Gmail: GMAIL_REFRESH_TOKEN revocado o vencido (genera otro con scope gmail.send).");
    if (j.error === "invalid_client" || j.error === "unauthorized_client") {
      throw new Error("Gmail: el refresh token es de otro cliente OAuth. Pon GMAIL_CLIENT_ID y GMAIL_CLIENT_SECRET del cliente que lo emitió.");
    }
    throw new Error(`Gmail token: ${j.error_description || j.error || r.status}`);
  }
  cached = { token: j.access_token, until: Date.now() + Math.max(60, (j.expires_in ?? 3600) - 120) * 1000 };
  return j.access_token;
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");
/** Sin saltos de línea: evita inyectar cabeceras desde un asunto o un correo. */
const clean = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

export type MailOptions = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** Cabeceras extra (p. ej. List-Unsubscribe del boletín). */
  headers?: Record<string, string>;
};

export async function sendMail(opts: MailOptions): Promise<void> {
  const token = await accessToken();
  const sender = env("GMAIL_SENDER") || env("SUPPORT_EMAIL") || "edroservices@gmail.com";
  const fromName = env("MAIL_FROM_NAME") || "FormsBot";
  const boundary = `fb_${Date.now().toString(36)}`;
  const text = opts.text || opts.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const extra = Object.entries(opts.headers ?? {}).map(([k, v]) => `${clean(k)}: ${clean(v)}`);

  const mime = [
    `From: =?UTF-8?B?${b64(fromName)}?= <${clean(sender)}>`,
    `To: ${clean(opts.to)}`,
    `Subject: =?UTF-8?B?${b64(clean(opts.subject))}?=`,
    ...extra,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64(text),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64(opts.html),
    `--${boundary}--`,
  ].join("\r\n");

  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: b64url(mime) }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Gmail send ${r.status}: ${body.slice(0, 200)}`);
  }
}
