/**
 * Notificaciones (campana) del cliente y del admin. Nunca rompen el flujo
 * que las genera: si la tabla no existe o falla la escritura, solo se registra.
 */
import { db } from "./db";
import { getUserLocale, trFor, type Tr } from "./userLocale";

export type NotificationInput = { kind?: string; title: string; body?: string; link?: string };

function clean(n: NotificationInput) {
  return {
    kind: (n.kind ?? "info").slice(0, 30),
    title: n.title.slice(0, 140),
    body: (n.body ?? "").slice(0, 500),
    link: (n.link ?? "").startsWith("/") ? (n.link ?? "").slice(0, 200) : "",
  };
}

/** `n` puede ser una función: recibe `tr` y arma el aviso en el idioma de la cuenta. */
export async function notifyUser(userId: string, n: NotificationInput | ((tr: Tr) => NotificationInput)): Promise<void> {
  try {
    const content = typeof n === "function" ? n(trFor(await getUserLocale(userId))) : n;
    await db().from("web_notifications").insert({ audience: "user", user_id: userId, ...clean(content) });
  } catch (e) {
    console.error("[notify] usuario:", e);
  }
}

export async function notifyAdmin(n: NotificationInput): Promise<void> {
  try {
    await db().from("web_notifications").insert({ audience: "admin", user_id: null, ...clean(n) });
  } catch (e) {
    console.error("[notify] admin:", e);
  }
}
