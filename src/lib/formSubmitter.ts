/**
 * Envía UNA respuesta a un Google Form. Puerto de la parte "por envío" de
 * app/core/submitter.py (ver PROYECTO.md) — la orquestación (secuencial,
 * paralelo, cola) no se porta aquí: en el servicio web la maneja el
 * endpoint de "tick" del job (Fase 3), llamando submitOne() por lotes.
 *
 * Formularios que recolectan correo como "Respuesta del usuario": igual que
 * el bot de escritorio, se agrega `emailAddress` con un correo generado
 * (coherente con el nombre de esa respuesta). Los de correo VERIFICADO
 * exigen iniciar sesión: Google redirige a accounts.google.com y eso se
 * reporta como NOT_PUBLIC, nunca como enviado.
 */

import type { ParsedForm } from "./formParser";
import type { FailureCode } from "./db";
import { createNameState, isNameField } from "./dataGen";

const UA_POOL = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:137.0) Gecko/20100101 Firefox/137.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
];

const SEC_CH_UA = [
  '"Google Chrome";v="136", "Chromium";v="136", "Not-A.Brand";v="99"',
  '"Google Chrome";v="135", "Chromium";v="135", "Not-A.Brand";v="99"',
  '"Google Chrome";v="134", "Chromium";v="134", "Not-A.Brand";v="99"',
];

const ACCEPT_LANG = [
  "es-ES,es;q=0.9,en;q=0.8",
  "es-MX,es;q=0.9,en-US;q=0.8",
  "es-AR,es;q=0.9,en;q=0.7",
  "es-CO,es;q=0.9,en;q=0.8",
  "es-PE,es;q=0.9,en;q=0.8",
  "es;q=0.9,en;q=0.8",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomFbzx(): string {
  // rango equivalente a random.randint(-9e18, 9e18) del bot de escritorio
  const sign = Math.random() < 0.5 ? -1 : 1;
  return String(sign * Math.floor(Math.random() * 9_000_000_000_000_000_000));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getHeaders(ua: string): Record<string, string> {
  return {
    "User-Agent": ua,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": pick(ACCEPT_LANG),
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
  };
}

function postHeaders(viewUrl: string, ua: string): Record<string, string> {
  return {
    "User-Agent": ua,
    Referer: viewUrl,
    Origin: "https://docs.google.com",
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": pick(ACCEPT_LANG),
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-User": "?1",
    "Sec-Ch-Ua": pick(SEC_CH_UA),
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": pick(['"Windows"', '"macOS"', '"Linux"']),
  };
}

/** Construye el payload (lista de pares, admite keys repetidas para casillas). */
export function buildPayload(form: ParsedForm, profile: Record<string, string>): [string, string][] {
  const typeByEntry = new Map(form.questions.map((q) => [q.entry, q.type]));
  const n = Math.max(1, form.numSections);

  const payload: [string, string][] = [
    ["fvv", "1"],
    ["fbzx", randomFbzx()],
    ["pageHistory", Array.from({ length: n }, (_, i) => i).join(",")],
  ];

  for (const [entry, rawValue] of Object.entries(profile)) {
    const qType = typeByEntry.get(entry) ?? 0;
    const val = String(rawValue ?? "");

    if (qType === 9) {
      const parts = val.split("-");
      if (parts.length === 3) {
        payload.push([`${entry}_year`, parts[0]], [`${entry}_month`, String(parseInt(parts[1], 10))], [
          `${entry}_day`,
          String(parseInt(parts[2], 10)),
        ]);
      }
    } else if (qType === 10) {
      const parts = val.split(":");
      if (parts.length >= 2) {
        payload.push([`${entry}_hour`, String(parseInt(parts[0], 10))], [
          `${entry}_minute`,
          String(parseInt(parts[1], 10)),
        ]);
      }
    } else if (qType === 4 || qType === 13) {
      for (const v of val.split("|")) {
        const trimmed = v.trim();
        if (trimmed) payload.push([entry, trimmed]);
      }
    } else if (val) {
      payload.push([entry, val]);
    }
  }

  return payload;
}

export interface SubmitDetail {
  /** Título de la pregunta que Google marcó con error, si se pudo identificar. */
  question?: string;
  message: string;
}

export interface SubmitResult {
  ok: boolean;
  status: number;
  detail?: SubmitDetail;
  /** Causa ya conocida por la respuesta de Google (si no, se deduce del mensaje). */
  code?: FailureCode;
  /** Google pidió el correo del encuestado y no lo mandamos: reintentar con correo. */
  needsEmail?: boolean;
}

// Dominios reservados (RFC 2606): no existen buzones. Si el formulario tiene
// "Enviar a los encuestados una copia de sus respuestas", Google no le
// escribe a una persona real que casualmente tenga ese correo.
const SAFE_EMAIL_DOMAINS = ["example.com", "example.org", "example.net"];

/** Correo para el campo `emailAddress`, a partir del nombre de esa misma respuesta. */
export function emailForProfile(form: ParsedForm, profile: Record<string, string>): string {
  const nameQ = form.questions.find((q) => isNameField(q));
  const local = createNameState()
    .randomEmailFromName(nameQ ? profile[nameQ.entry] : undefined)
    .split("@")[0];
  return `${local}@${pick(SAFE_EMAIL_DOMAINS)}`;
}

function isLoginUrl(location: string): boolean {
  return /accounts\.google\.com|servicelogin|\/signin/i.test(location);
}

/** El HTML re-pintado por Google trae el campo de correo del encuestado. */
function asksRespondentEmail(html: string): boolean {
  return /name="emailAddress"/i.test(html) || /"emailAddress"/.test(html);
}

const CLOSED_RE = /closedform|ya no acepta respuestas|no longer accepting responses|is no longer accepting/i;

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const ERROR_PHRASES =
  /(obligatoria|required|debe ser|must be|n[uú]mero|number|v[aá]lid|caracteres|characters|formato|format)/i;

/**
 * Cuando Google rechaza un envío (HTTP 400) vuelve a pintar el formulario:
 * cada pregunta es un bloque role="listitem" con su título en
 * role="heading" y, si falló, el mensaje en un <span class="RHiWt">.
 * (Verificado en vivo 2026-10-21; las clases de Google son ofuscadas y
 * pueden cambiar, por eso hay respaldo por frases conocidas.)
 */
export function extractGoogleError(html: string, form: ParsedForm, textFallback = true): SubmitDetail | undefined {
  const blocks = html.split('role="listitem"').slice(1);
  for (const block of blocks) {
    const heading = block.match(/role="heading"[^>]*>([\s\S]*?)<\/div>/);
    const title = heading ? stripTags(heading[1]).replace(/\s*\*$/, "").trim() : "";
    let message = "";
    const span = block.match(/class="RHiWt"[^>]*>([^<]{2,300})</);
    if (span) message = stripTags(span[1]);
    if (!message) {
      const alert = block.match(/role="alert"[^>]*>([\s\S]{0,2000}?)<\/div>\s*<\/div>/);
      const text = alert ? stripTags(alert[1]) : "";
      if (text && ERROR_PHRASES.test(text) && text.length < 300) message = text;
    }
    if (message) {
      const q = form.questions.find((x) => x.title === title || x.title.split(" — ")[0] === title);
      return { question: q?.title ?? (title || undefined), message };
    }
  }
  if (!textFallback) return undefined;
  // Ojo: el formulario siempre trae estos textos en sus plantillas JS, por
  // eso este atajo solo se usa cuando Google ya respondió con error (4xx).
  const lower = html.toLowerCase();
  if (lower.includes("esta pregunta es obligatoria") || lower.includes("this is a required question")) {
    return { message: "Hay una pregunta obligatoria sin responder." };
  }
  return undefined;
}

/** Causa de un rechazo (para la ventana de ayuda del cliente). */
export function failureCode(form: ParsedForm, result: SubmitResult): FailureCode {
  if (result.code) return result.code;
  const msg = (result.detail?.message ?? "").toLowerCase();
  const question = result.detail?.question ? form.questions.find((x) => x.title === result.detail?.question) : undefined;
  if (result.status === 0) return "NETWORK";
  if (result.status === 429) return "RATE_LIMIT";
  if (result.status === 401 || result.status === 403) return "NOT_PUBLIC";
  if (msg.includes("obligatoria") || msg.includes("required")) return "REQUIRED";
  if (question?.validation || ERROR_PHRASES.test(msg)) return "VALIDATION";
  return "OTHER";
}

/** Sugerencia en español para arreglar un envío fallido. */
export function failureHint(form: ParsedForm, result: SubmitResult): string {
  if (result.code === "NOT_PUBLIC") {
    return 'Tu formulario pide iniciar sesión con Google. En Google Forms → Configuración → Respuestas desactiva "Limitar a 1 respuesta", "Restringir a usuarios de tu organización" y en "Recopilar correos" elige "Respuesta del usuario" o "No recopilar" (no "Verificado").';
  }
  if (result.code === "CLOSED") {
    return 'Tu formulario dejó de aceptar respuestas. En Google Forms → pestaña Respuestas activa "Se aceptan respuestas".';
  }
  if (result.code === "NEEDS_EMAIL") {
    return 'Tu formulario pide el correo de quien responde. Ya lo completamos con correos generados; si sigue fallando, en Configuración → Respuestas → "Recopilar correos" elige "Respuesta del usuario" (no "Verificado").';
  }
  const q = result.detail?.question;
  const msg = (result.detail?.message ?? "").toLowerCase();
  const question = q ? form.questions.find((x) => x.title === q) : undefined;
  const name = q ? `"${q}"` : "una pregunta";

  if (result.status === 0) return "No hubo conexión con Google en ese intento. Si se repite, vuelve a intentar en unos minutos.";
  if (result.status === 429) return "Google frenó los envíos por ir muy seguidos. Espera unos minutos y vuelve a enviar.";
  if (msg.includes("obligatoria") || msg.includes("required")) {
    return `${name} es obligatoria y quedó vacía. Configúrala como Aleatorio o Fijo.`;
  }
  if (question?.validation?.kind === "number" || msg.includes("número") || msg.includes("numero") || msg.includes("number")) {
    const v = question?.validation;
    const range =
      v?.kind === "number" && v.min !== undefined && v.max !== undefined ? `${v.min}-${v.max}` : "18-65";
    return `${name} solo acepta números. Configúrala como Fijo con un rango como ${range}.`;
  }
  if (question?.validation?.kind === "email" || msg.includes("correo") || msg.includes("email")) {
    return `${name} pide un correo válido. Configúrala como Aleatorio: genera correos con formato correcto.`;
  }
  if (msg.includes("caracteres") || msg.includes("characters")) {
    return `${name} tiene un límite de caracteres. Usa Fijo con respuestas cortas separadas por |.`;
  }
  if (result.detail?.message) {
    return `Google rechazó ${name} con el mensaje "${result.detail.message}". Revisa su configuración y usa Fijo con un valor que cumpla esa regla.`;
  }
  return "Google rechazó la respuesta. Suele pasar con preguntas obligatorias sin configurar o con validaciones de formato: revisa que cada pregunta tenga un valor válido.";
}

const GET_TIMEOUT_MS = 6_000;
const POST_TIMEOUT_MS = 12_000;

export interface SubmitOptions {
  /** Espera entre abrir el formulario y enviarlo (ms). Por defecto 200–700 ms. */
  readDelayMs?: [number, number];
}

/** GET view_url (para cookies reales) → espera → POST submit_url. */
export async function submitOne(
  form: ParsedForm,
  profile: Record<string, string>,
  opts: SubmitOptions = {}
): Promise<SubmitResult> {
  const ua = pick(UA_POOL);
  const withEmail =
    form.collectsEmail && !profile.emailAddress ? { ...profile, emailAddress: emailForProfile(form, profile) } : profile;
  const payload = buildPayload(form, withEmail);
  const [dMin, dMax] = opts.readDelayMs ?? [200, 700];

  try {
    // El GET solo sirve para obtener cookies. Si Google tarda, se envía sin
    // ellas en vez de colgar la función: sin tiempo máximo, un GET lento
    // dejaba la invocación esperando hasta que Vercel la mataba (504) sin
    // guardar nada, y el envío quedaba trabado para siempre.
    let cookieHeader = "";
    try {
      const getRes = await fetch(form.viewUrl, {
        headers: getHeaders(ua),
        cache: "no-store",
        signal: AbortSignal.timeout(GET_TIMEOUT_MS),
      });
      const setCookies =
        typeof (getRes.headers as { getSetCookie?: () => string[] }).getSetCookie === "function"
          ? (getRes.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
          : getRes.headers.get("set-cookie")
            ? [getRes.headers.get("set-cookie") as string]
            : [];
      cookieHeader = setCookies.map((c) => c.split(";")[0]).join("; ");
      // Se descarta el cuerpo sin esperarlo: solo interesaban las cookies.
      void getRes.body?.cancel().catch(() => {});
    } catch {
      // seguimos sin cookies
    }

    // Jitter corto: no parecer una ráfaga idéntica, sin frenar de más.
    await sleep(dMin + Math.random() * Math.max(0, dMax - dMin));

    const body = new URLSearchParams();
    for (const [k, v] of payload) body.append(k, v);

    const postRes = await fetch(form.submitUrl, {
      method: "POST",
      headers: {
        ...postHeaders(form.viewUrl, ua),
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      body: body.toString(),
      redirect: "manual", // Google responde 302 en éxito; no seguirlo, solo observar el status
      cache: "no-store",
      signal: AbortSignal.timeout(POST_TIMEOUT_MS),
    });

    if (postRes.status === 302 || postRes.status === 303) {
      const location = postRes.headers.get("location") ?? "";
      await postRes.body?.cancel().catch(() => {});
      // Una redirección al login NO es un envío: Google pide iniciar sesión
      // (antes contaba como enviada y el cliente veía respuestas que no existían).
      if (isLoginUrl(location)) {
        return { ok: false, status: postRes.status, code: "NOT_PUBLIC", detail: { message: "Google pidió iniciar sesión para responder." } };
      }
      if (CLOSED_RE.test(location)) {
        return { ok: false, status: postRes.status, code: "CLOSED", detail: { message: "El formulario ya no acepta respuestas." } };
      }
      return { ok: true, status: postRes.status };
    }

    const html = await postRes.text().catch(() => "");
    if (CLOSED_RE.test(html) && !html.includes("FB_PUBLIC_LOAD_DATA_")) {
      return { ok: false, status: postRes.status, code: "CLOSED", detail: { message: "El formulario ya no acepta respuestas." } };
    }
    if (!form.collectsEmail && postRes.status !== 200 && asksRespondentEmail(html)) {
      return { ok: false, status: postRes.status, code: "NEEDS_EMAIL", needsEmail: true, detail: { message: "El formulario pide el correo de quien responde." } };
    }
    if (postRes.status === 200) {
      // 200 normalmente es la página de "respuesta registrada". Si en cambio
      // Google re-pintó el formulario con errores, no cuenta como enviada.
      const detail = html.includes("FB_PUBLIC_LOAD_DATA_") ? extractGoogleError(html, form, false) : undefined;
      if (!detail) return { ok: true, status: 200 };
      return { ok: false, status: 200, detail };
    }

    const detail = extractGoogleError(html, form);
    console.error(
      `[submitOne] fallo HTTP ${postRes.status} enviando a ${form.submitUrl} — cookies=${cookieHeader ? "sí" : "no"} — ${detail ? `${detail.question ?? "?"}: ${detail.message}` : html.slice(0, 200)}`
    );
    return { ok: false, status: postRes.status, detail };
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    console.error(`[submitOne] ${timedOut ? "timeout" : "excepción"} enviando a ${form.submitUrl}:`, e instanceof Error ? e.message : e);
    return {
      ok: false,
      status: 0,
      detail: { message: timedOut ? "Google tardó demasiado en responder." : "Sin conexión con Google." },
    };
  }
}
