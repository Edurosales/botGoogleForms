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

export interface SubmitResult {
  ok: boolean;
  status: number;
}

/** GET view_url (para cookies reales) → espera → POST submit_url. */
export async function submitOne(form: ParsedForm, profile: Record<string, string>): Promise<SubmitResult> {
  const ua = pick(UA_POOL);
  const payload = buildPayload(form, profile);

  try {
    const getRes = await fetch(form.viewUrl, { headers: getHeaders(ua) });
    const setCookies =
      typeof (getRes.headers as { getSetCookie?: () => string[] }).getSetCookie === "function"
        ? (getRes.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
        : getRes.headers.get("set-cookie")
          ? [getRes.headers.get("set-cookie") as string]
          : [];
    const cookieHeader = setCookies.map((c) => c.split(";")[0]).join("; ");

    await sleep(400 + Math.random() * 1400); // 0.4–1.8s, simula lectura del form

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
    });

    const ok = postRes.status === 200 || postRes.status === 302 || postRes.status === 303;
    if (!ok) {
      const snippet = await postRes.text().catch(() => "");
      console.error(
        `[submitOne] fallo HTTP ${postRes.status} enviando a ${form.submitUrl} — cookies=${cookieHeader ? "sí" : "no"} — respuesta: ${snippet.slice(0, 300)}`
      );
    }
    return { ok, status: postRes.status };
  } catch (e) {
    console.error(`[submitOne] excepción enviando a ${form.submitUrl}:`, e instanceof Error ? e.message : e);
    return { ok: false, status: 0 };
  }
}
