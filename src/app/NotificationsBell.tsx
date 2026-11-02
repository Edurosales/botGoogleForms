"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BALANCE_EVENT } from "./clientData";
import { useLang } from "./LangProvider";
import { DATE_LOCALE_TAG } from "@/lib/i18n";

type Item = { id: string; kind: string; title: string; body: string; link: string; read_at: string | null; created_at: string };

const POLL_MS = 15_000;

/** Ícono según el tipo de aviso (solo decorativo). */
const KIND_ICON: Record<string, string> = {
  job: "✓",
  refund: "↩",
  purchase: "★",
  credits: "★",
  gift: "🎁",
  message: "💬",
  account: "!",
  alert: "!",
};

function ago(iso: string, tag: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  const rtf = new Intl.RelativeTimeFormat(tag, { numeric: "auto", style: "short" });
  if (s < 60) return rtf.format(0, "second");
  if (s < 3600) return rtf.format(-Math.floor(s / 60), "minute");
  if (s < 86400) return rtf.format(-Math.floor(s / 3600), "hour");
  return new Date(iso).toLocaleDateString(tag, { day: "numeric", month: "short" });
}

/** Campana de notificaciones: número de no leídas, lista, marcar leídas y borrar. */
export default function NotificationsBell() {
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const { t, locale } = useLang();
  const ref = useRef<HTMLDivElement>(null);
  // Cada cambio local (marcar, borrar) sube la versión: una carga que empezó
  // ANTES no puede pisarlo con datos viejos (antes lo marcado "se volvía").
  const version = useRef(0);

  const load = useCallback(async () => {
    const v = version.current;
    try {
      const r = await fetch("/api/web/notifications", { cache: "no-store" });
      if (!r.ok) return;
      const d = await r.json();
      if (v !== version.current) return;
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

  /** Cambio local inmediato; se confirma con el servidor y recién ahí se recarga. */
  async function mutate(apply: () => void, request: () => Promise<Response>) {
    version.current++;
    apply();
    const ok = await request().then((r) => r.ok).catch(() => false);
    version.current++;
    // Si el servidor no lo guardó, se recarga lo real (no queda un estado falso).
    if (!ok) void load();
  }

  async function markRead(body: { id?: string; all?: boolean }) {
    await mutate(
      () => {
        setItems((prev) => prev.map((n) => (body.all || n.id === body.id ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n)));
        setUnread((u) => (body.all ? 0 : Math.max(0, u - 1)));
      },
      () =>
        fetch("/api/web/notifications", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
    );
  }

  async function removeAll() {
    await mutate(
      () => {
        setItems([]);
        setUnread(0);
      },
      () => fetch("/api/web/notifications?all=1", { method: "DELETE" })
    );
  }

  async function remove(n: Item) {
    await mutate(
      () => {
        setItems((prev) => prev.filter((x) => x.id !== n.id));
        if (!n.read_at) setUnread((u) => Math.max(0, u - 1));
      },
      () => fetch(`/api/web/notifications?id=${encodeURIComponent(n.id)}`, { method: "DELETE" })
    );
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
        aria-label={unread > 0 ? t("bell.unread", { n: unread }) : t("bell.title")}
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
        <div className="nb-panel" role="dialog" aria-label={t("bell.title")}>
          <div className="nb-head">
            <strong>{t("bell.title")}</strong>
            <div className="nb-head-actions">
              {/* Siempre en su lugar (desactivado si no hay pendientes): la cabecera no salta. */}
              <button type="button" className="nb-link" onClick={() => markRead({ all: true })} disabled={unread === 0}>
                {t("bell.markRead")}
              </button>
              {items.length > 0 && (
                <button type="button" className="nb-link nb-link-mute" onClick={removeAll}>
                  {t("bell.deleteAll")}
                </button>
              )}
              <button type="button" className="nb-close" aria-label={t("sup.close")} onClick={() => setOpen(false)}>
                ×
              </button>
            </div>
          </div>
          {items.length === 0 ? (
            <p className="nb-empty">{t("bell.empty")}</p>
          ) : (
            <ul className="nb-list">
              {items.map((n) => (
                <li key={n.id} className={n.read_at ? "nb-item" : "nb-item is-unread"}>
                  <span className={`nb-ico nb-ico-${n.kind}`} aria-hidden="true">
                    {KIND_ICON[n.kind] ?? "•"}
                  </span>
                  <button type="button" className="nb-main" onClick={() => openItem(n)}>
                    <span className="nb-title">{n.title}</span>
                    {n.body && <span className="nb-body">{n.body}</span>}
                    <span className="nb-time">{ago(n.created_at, DATE_LOCALE_TAG[locale])}</span>
                  </button>
                  <button type="button" className="nb-del" aria-label={t("bell.delete")} onClick={() => remove(n)}>
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
