/**
 * Notificaciones (campana) del cliente y del admin. Nunca rompen el flujo
 * que las genera: si la tabla no existe o falla la escritura, solo se registra.
 */
import { db } from "./db";

export type NotificationInput = { kind?: string; title: string; body?: string; link?: string };

function clean(n: NotificationInput) {
  return {
    kind: (n.kind ?? "info").slice(0, 30),
    title: n.title.slice(0, 140),
    body: (n.body ?? "").slice(0, 500),
    link: (n.link ?? "").startsWith("/") ? (n.link ?? "").slice(0, 200) : "",
  };
}

export async function notifyUser(userId: string, n: NotificationInput): Promise<void> {
  try {
    await db().from("web_notifications").insert({ audience: "user", user_id: userId, ...clean(n) });
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
