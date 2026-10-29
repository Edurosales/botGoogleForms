"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { SUPPORT_EMAIL, SUPPORT_TELEGRAM, useMe, usePublicSettings, whatsappLink } from "./clientData";

/** Abre el chat desde otra parte de la página (ej. "Mi cuenta → Mensajes"). */
export const OPEN_CHAT_EVENT = "formsbot:open-chat";
export function openSupportChat() {
  window.dispatchEvent(new Event(OPEN_CHAT_EVENT));
}

type Msg = { id: number; sender: "user" | "admin" | "system"; body: string; created_at: string; read_at: string | null };
type Thread = { messages: Msg[]; unread: number; canSend: boolean; left: number; perDay: number; maxChars: number };

const noSubscribe = () => () => {};

function when(iso: string): string {
  return new Date(iso).toLocaleString("es-PE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * Botón flotante "Soporte" en todas las páginas. Con sesión iniciada abre
 * también el chat con el dueño (mensajes en la misma página, se actualizan
 * solos); sin sesión, WhatsApp, Telegram o correo.
 */
export default function SupportButton() {
  const settings = usePublicSettings();
  const { me } = useMe();
  const path = usePathname() || "/";
  // ?chat=1 (enlace de la notificación) abre el chat al cargar.
  const askedByUrl = useSyncExternalStore(
    noSubscribe,
    () => new URLSearchParams(window.location.search).get("chat") === "1",
    () => false
  );
  const [picked, setPicked] = useState<boolean | null>(null);
  const open = picked ?? (askedByUrl && Boolean(me));
  const [thread, setThread] = useState<Thread | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const logged = Boolean(me);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/web/messages", { cache: "no-store" });
      if (!r.ok) return;
      const d = await r.json();
      if (d.ok) setThread(d as Thread);
    } catch {
      /* sin red: se reintenta */
    }
  }, []);

  // Mensajes "en vivo": cada 6 s con el chat abierto, cada 45 s cerrado (para el número).
  useEffect(() => {
    if (!logged) return;
    const first = setTimeout(load, 0);
    const t = setInterval(() => document.visibilityState === "visible" && load(), open ? 6_000 : 45_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [logged, open, load]);

  // Al abrir con mensajes nuevos de soporte: se marcan leídos.
  const unread = thread?.unread ?? 0;
  useEffect(() => {
    if (!open || !unread) return;
    fetch("/api/web/messages", { method: "PATCH" })
      .then(() => setThread((t) => (t ? { ...t, unread: 0 } : t)))
      .catch(() => {});
  }, [open, unread]);

  const count = thread?.messages.length ?? 0;
  useEffect(() => {
    if (open && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [open, count]);

  useEffect(() => {
    const onOpen = () => setPicked(true);
    window.addEventListener(OPEN_CHAT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_CHAT_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setPicked(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError("");
    try {
      const r = await fetch("/api/web/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const d = await r.json().catch(() => ({}));
      if (!d.ok) setError(String(d.error || "No se pudo enviar."));
      else {
        setDraft("");
        await load();
      }
    } catch {
      setError("No se pudo conectar. Intenta de nuevo.");
    } finally {
      setSending(false);
    }
  }

  const msg = `Hola, necesito ayuda con FormsBot (página ${path}).`;
  const channels = (
    <div className="support-channels">
      <a href={whatsappLink(settings.whatsappNumber, msg)} target="_blank" rel="noopener noreferrer">
        <span className="sm-ico sm-wa" aria-hidden="true">W</span> WhatsApp
      </a>
      <a href={SUPPORT_TELEGRAM} target="_blank" rel="noopener noreferrer">
        <span className="sm-ico sm-tg" aria-hidden="true">T</span> Telegram
      </a>
      <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Ayuda con FormsBot")}&body=${encodeURIComponent(msg)}`}>
        <span className="sm-ico sm-mail" aria-hidden="true">@</span> Correo
      </a>
    </div>
  );
  const maxChars = thread?.maxChars ?? 500;

  return (
    <div className="support" ref={box}>
      {open && !logged && (
        <div className="support-menu" role="menu">
          <p>¿Cómo prefieres que te ayudemos?</p>
          {channels}
        </div>
      )}
      {open && logged && (
        <div className="support-chat" role="dialog" aria-label="Mensajes con soporte">
          <div className="sc-head">
            <div>
              <strong>Soporte FormsBot</strong>
              <span>Te respondemos por aquí mismo</span>
            </div>
            <button type="button" className="sc-close" aria-label="Cerrar" onClick={() => setPicked(false)}>
              ×
            </button>
          </div>
          <div className="sc-list" ref={list} aria-live="polite">
            {thread === null && <p className="sc-empty">Cargando…</p>}
            {thread && thread.messages.length === 0 && (
              <p className="sc-empty">
                {thread.canSend ? "¿En qué te ayudamos? Escribe tu consulta abajo." : "Aún no tienes mensajes. Si necesitas ayuda, escríbenos por WhatsApp, Telegram o correo."}
              </p>
            )}
            {thread?.messages.map((m) => (
              <div key={m.id} className={`sc-msg sc-${m.sender === "user" ? "me" : "them"}`}>
                {m.sender !== "user" && <span className="sc-who">{m.sender === "system" ? "FormsBot (automático)" : "Soporte"}</span>}
                <p>{m.body}</p>
                <time dateTime={m.created_at}>{when(m.created_at)}</time>
              </div>
            ))}
          </div>
          {thread?.canSend ? (
            <form className="sc-form" onSubmit={send}>
              <label className="sr" htmlFor="sc-input">
                Tu mensaje
              </label>
              <textarea
                id="sc-input"
                rows={2}
                maxLength={maxChars}
                placeholder={thread.left > 0 ? "Escribe tu mensaje…" : "Llegaste al máximo de mensajes de hoy"}
                value={draft}
                disabled={thread.left <= 0 || sending}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <div className="sc-foot">
                <span>
                  {draft.length}/{maxChars} · te quedan {thread.left} de {thread.perDay} mensajes hoy
                </span>
                <button type="submit" className="b b-primary b-small" disabled={!draft.trim() || sending || thread.left <= 0}>
                  {sending ? "Enviando…" : "Enviar"}
                </button>
              </div>
              {error && (
                <p className="sc-err" role="alert">
                  {error}
                </p>
              )}
            </form>
          ) : (
            thread && <p className="sc-note">El chat se activa cuando intentas comprar créditos. Mientras tanto:</p>
          )}
          {channels}
        </div>
      )}
      <button
        type="button"
        className="support-fab"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={unread > 0 ? `Soporte, ${unread} mensajes nuevos` : "Contactar a soporte"}
        onClick={() => setPicked(!open)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 2C6.5 2 2 6 2 11c0 2.6 1.2 4.9 3.2 6.6L4.5 22l4.3-2.2c1 .3 2.1.4 3.2.4 5.5 0 10-4 10-9S17.5 2 12 2Zm-4 10.3a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6Zm4 0a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6Zm4 0a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6Z"
          />
        </svg>
        <span>{logged ? "Mensajes" : "Soporte"}</span>
        {unread > 0 && <b className="support-badge">{unread > 9 ? "9+" : unread}</b>}
      </button>
    </div>
  );
}
