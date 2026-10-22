import { headers } from "next/headers";

export type RequestMeta = { ip: string; country: string; userAgent: string; path: string };

/** IP, país (cabecera de Vercel), navegador y ruta de la petición en curso. */
export async function requestMeta(): Promise<RequestMeta> {
  try {
    const h = await headers();
    const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || (h.get("x-real-ip") ?? "").trim();
    const country = (h.get("x-vercel-ip-country") ?? "").trim().toUpperCase().slice(0, 2);
    const userAgent = (h.get("user-agent") ?? "").slice(0, 300);
    const path = (h.get("x-invoke-path") ?? h.get("referer") ?? "").slice(0, 300);
    return { ip: ip.slice(0, 64), country: /^[A-Z]{2}$/.test(country) ? country : "", userAgent, path };
  } catch {
    // Fuera de una petición (worker en after()): sin datos de red.
    return { ip: "", country: "", userAgent: "", path: "" };
  }
}
