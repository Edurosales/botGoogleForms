import { NextResponse } from "next/server";
import { getWebUser } from "@/lib/googleAuth";
import { rateLimit } from "@/lib/ratelimit";
import { sheetCsvUrl } from "@/lib/sheetUrl";

const MAX_BYTES = 2_000_000;

/** POST { url } → el CSV de una hoja de Google compartida ("cualquier persona con el enlace"). */
export async function POST(req: Request) {
  const user = await getWebUser();
  if (!user) return NextResponse.json({ ok: false, reason: "Inicia sesión." }, { status: 401 });
  // Solo para clientes con créditos (comprados o regalados): leer hojas ajenas
  // a Google cuesta servidor y es parte del servicio de pago.
  if (user.credits <= 0) {
    return NextResponse.json({ ok: false, code: "DATA_REQUIRES_PAID", reason: "Usar tus datos es para clientes con créditos comprados o regalados." }, { status: 402 });
  }
  if (!rateLimit(`web-sheet:${user.id}`, 15, 10 * 60_000)) {
    return NextResponse.json({ ok: false, reason: "Demasiados intentos. Espera unos minutos." }, { status: 429 });
  }
  const b = (await req.json().catch(() => ({}))) as { url?: unknown };
  const url = typeof b.url === "string" ? sheetCsvUrl(b.url.slice(0, 600)) : null;
  if (!url) return NextResponse.json({ ok: false, reason: "Pega el link de una hoja de Google Sheets." }, { status: 400 });

  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(12_000), cache: "no-store" });
    const type = res.headers.get("content-type") ?? "";
    // Una hoja privada devuelve la página de inicio de sesión (HTML), no el CSV.
    if (!res.ok || !/text\/csv|text\/plain|application\/octet-stream/i.test(type)) {
      return NextResponse.json(
        { ok: false, reason: "No pudimos leer la hoja. Compártela como \"Cualquier persona con el enlace\" (lector) y vuelve a intentarlo." },
        { status: 400 }
      );
    }
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        return NextResponse.json({ ok: false, reason: "La hoja es demasiado grande (máx. 2 MB)." }, { status: 400 });
      }
      chunks.push(value);
    }
    const csv = new TextDecoder().decode(Buffer.concat(chunks));
    return NextResponse.json({ ok: true, csv });
  } catch {
    return NextResponse.json({ ok: false, reason: "No pudimos leer la hoja. Intenta de nuevo en un momento." }, { status: 502 });
  }
}
