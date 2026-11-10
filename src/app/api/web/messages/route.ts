import { NextResponse } from "next/server";
import { getWebUser } from "@/lib/googleAuth";
import { db } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { cleanMessage, isPayingCustomer, sendUserMessage, sentToday, splitConversations, thread, USER_MSG_MAX_CHARS, USER_MSG_PER_DAY, USER_MSG_PER_DAY_PAID } from "@/lib/messages";

const missing = (m: string) => /does not exist|schema cache/i.test(m);

/**
 * GET → la conversación propia con soporte, si puede escribir y cuántos
 * mensajes le quedan hoy. Cada usuario solo ve la suya (filtro por user.id
 * de la sesión, nunca por un id que mande el navegador).
 */
export async function GET() {
  const user = await getWebUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  // El chat abierto consulta cada 6 s; más que esto es abuso.
  if (!rateLimit(`msg-read:${user.id}`, 40, 60_000)) return NextResponse.json({ ok: false }, { status: 429 });
  const [messages, paying, used, unread] = await Promise.all([
    thread(user.id),
    isPayingCustomer(user.id, user.credits).catch(() => false),
    sentToday(user.id).catch(() => 0),
    db()
      .from("web_messages")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .neq("sender", "user")
      .is("read_at", null)
      .then(
        (r) => r.count ?? 0,
        () => 0
      ),
  ]);
  // Conversación abierta (últimas 24 h) y las cerradas, para "Chats anteriores".
  const { current, previous } = splitConversations(messages);
  return NextResponse.json({
    ok: true,
    messages: current,
    previous,
    unread,
    // Toda cuenta puede escribir: 2 por día, 4 si ya compró.
    canSend: !user.bannedReason,
    left: Math.max(0, (paying ? USER_MSG_PER_DAY_PAID : USER_MSG_PER_DAY) - used),
    perDay: paying ? USER_MSG_PER_DAY_PAID : USER_MSG_PER_DAY,
    maxChars: USER_MSG_MAX_CHARS,
  });
}

/** POST { body } → envía un mensaje (máx. 500 caracteres; 2 por día, 4 si ya compró). */
export async function POST(req: Request) {
  const user = await getWebUser();
  if (!user) return NextResponse.json({ ok: false, error: "Inicia sesión." }, { status: 401 });
  if (!rateLimit(`msg:${user.id}`, 4, 10 * 60_000) || !rateLimit(`msg-ip:${clientIp(req)}`, 10, 10 * 60_000)) {
    return NextResponse.json({ ok: false, error: "Espera unos minutos antes de volver a escribir." }, { status: 429 });
  }
  if (user.bannedReason) return NextResponse.json({ ok: false, error: "Tu cuenta está bloqueada." }, { status: 403 });
  const raw = (await req.json().catch(() => ({}))) as { body?: unknown };
  const body = cleanMessage(raw.body);
  if (!body) return NextResponse.json({ ok: false, error: "Escribe tu mensaje." }, { status: 400 });
  if (body.length > USER_MSG_MAX_CHARS) {
    return NextResponse.json({ ok: false, error: `Máximo ${USER_MSG_MAX_CHARS} caracteres.` }, { status: 400 });
  }
  const perDay = (await isPayingCustomer(user.id, user.credits).catch(() => false)) ? USER_MSG_PER_DAY_PAID : USER_MSG_PER_DAY;
  try {
    const id = await sendUserMessage(user, body, perDay);
    if (!id) {
      return NextResponse.json(
        { ok: false, error: `Ya enviaste ${perDay} mensajes en las últimas 24 h. Te respondemos por aquí; si es urgente, usa WhatsApp o Telegram.` },
        { status: 429 }
      );
    }
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[messages] enviar:", msg);
    return NextResponse.json({ ok: false, error: missing(msg) ? "El chat aún no está disponible." : "No se pudo enviar. Intenta de nuevo." }, { status: 500 });
  }
}

/** PATCH → marca como leídos los mensajes de soporte de su conversación. */
export async function PATCH() {
  const user = await getWebUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  await db()
    .from("web_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .neq("sender", "user")
    .is("read_at", null)
    .then(
      () => {},
      () => {}
    );
  return NextResponse.json({ ok: true });
}
