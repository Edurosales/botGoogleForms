/**
 * Envía UNA respuesta a un Google Form. Puerto de la parte "por envío" de
 * app/core/submitter.py (ver PROYECTO.md) — la orquestación (secuencial,
 * paralelo, cola) no se porta aquí: en el servicio web la maneja el
 * endpoint de "tick" del job (Fase 3), llamando submitOne() por lotes.
 *
 * Nota: el servicio bloquea la creación de jobs cuando
 * `form.collectsEmail` es true (ver formParser.ts / página principal),
 * así que a diferencia del bot de escritorio, aquí NO se agrega el campo
 * emailAddress al payload.
 */

import type { ParsedForm } from "./formParser";

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
}

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

/** Sugerencia en español para arreglar un envío fallido. */
export function failureHint(form: ParsedForm, result: SubmitResult): string {
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
  const payload = buildPayload(form, profile);
  const [dMin, dMax] = opts.readDelayMs ?? [200, 700];

  try {
    const getRes = await fetch(form.viewUrl, { headers: getHeaders(ua), cache: "no-store" });
    const setCookies =
      typeof (getRes.headers as { getSetCookie?: () => string[] }).getSetCookie === "function"
        ? (getRes.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
        : getRes.headers.get("set-cookie")
          ? [getRes.headers.get("set-cookie") as string]
          : [];
    const cookieHeader = setCookies.map((c) => c.split(";")[0]).join("; ");
    // Se descarta el cuerpo: solo interesaban las cookies.
    await getRes.body?.cancel().catch(() => {});

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
    });

    if (postRes.status === 302 || postRes.status === 303) {
      await postRes.body?.cancel().catch(() => {});
      return { ok: true, status: postRes.status };
    }

    const html = await postRes.text().catch(() => "");
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
    console.error(`[submitOne] excepción enviando a ${form.submitUrl}:`, e instanceof Error ? e.message : e);
    return { ok: false, status: 0, detail: { message: "Sin conexión con Google." } };
  }
}
