"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BALANCE_EVENT } from "./clientData";

type Item = { id: string; kind: string; title: string; body: string; link: string; read_at: string | null; created_at: string };

const POLL_MS = 15_000;

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "ahora";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return new Date(iso).toLocaleDateString("es-PE", { day: "numeric", month: "short" });
}

/** Campana de notificaciones: número de no leídas, lista, marcar leídas y borrar. */
export default function NotificationsBell() {
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/web/notifications", { cache: "no-store" });
      if (!r.ok) return;
      const d = await r.json();
      setItems(Array.isArray(d.items) ? d.items : []);
      setUnread(Number(d.unread) || 0);
    } catch {
      /* sin red: se reintenta en la próxima vuelta */
    }
  }, []);

  // "Tiempo real" liviano: cada 15 s, al volver a la pestaña y cuando cambia el saldo.
  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, POLL_MS);
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener(BALANCE_EVENT, load);
    return () => {
      clearTimeout(first);
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener(BALANCE_EVENT, load);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function markRead(body: { id?: string; all?: boolean }) {
    setItems((prev) => prev.map((n) => (body.all || n.id === body.id ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n)));
    setUnread((u) => (body.all ? 0 : Math.max(0, u - 1)));
    await fetch("/api/web/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {});
  }

  async function remove(n: Item) {
    setItems((prev) => prev.filter((x) => x.id !== n.id));
    if (!n.read_at) setUnread((u) => Math.max(0, u - 1));
    await fetch(`/api/web/notifications?id=${encodeURIComponent(n.id)}`, { method: "DELETE" }).catch(() => {});
  }

  function openItem(n: Item) {
    if (!n.read_at) void markRead({ id: n.id });
    setOpen(false);
    if (n.link) window.location.assign(n.link);
  }

  return (
    <div className="nb" ref={ref}>
      <button
        type="button"
        className="nb-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread > 0 ? `Notificaciones, ${unread} sin leer` : "Notificaciones"}
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z"
          />
        </svg>
        {unread > 0 && <span className="nb-count">{unread > 9 ? "9+" : unread}</span>}
      </button>

      {open && (
        <div className="nb-panel" role="dialog" aria-label="Notificaciones">
          <div className="nb-head">
            <strong>Notificaciones</strong>
            {unread > 0 && (
              <button type="button" className="nb-link" onClick={() => markRead({ all: true })}>
                Marcar todo como leído
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="nb-empty">No tienes notificaciones.</p>
          ) : (
            <ul className="nb-list">
              {items.map((n) => (
                <li key={n.id} className={n.read_at ? "nb-item" : "nb-item is-unread"}>
                  <button type="button" className="nb-main" onClick={() => openItem(n)}>
                    <span className="nb-title">{n.title}</span>
                    {n.body && <span className="nb-body">{n.body}</span>}
                    <span className="nb-time">{ago(n.created_at)}</span>
                  </button>
                  <button type="button" className="nb-del" aria-label="Borrar notificación" onClick={() => remove(n)}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
