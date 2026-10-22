"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { announceBalanceChange, fmtPen, useMe, usePublicSettings } from "../clientData";
import { SignInCard } from "../SignIn";

type OrderRow = {
  order_id: string;
  credits: number;
  amount_cents: number;
  status: "paid" | "refunded";
  created_at: string;
  paid_at: string | null;
  refunded_at: string | null;
  refund_reason: string;
};

type JobRow = {
  id: string;
  title: string;
  total: number;
  sent: number;
  failed: number;
  status: string;
  createdAt: string;
};

const STATUS_LABEL: Record<string, string> = {
  queued: "En la fila",
  processing: "Enviando",
  done: "Terminado",
  failed: "Falló",
  rejected: "Rechazado",
};

function normalizeJobs(d: unknown): JobRow[] {
  const obj = (d ?? {}) as Record<string, unknown>;
  const list = (Array.isArray(obj.jobs) ? obj.jobs : Array.isArray(obj.items) ? obj.items : []) as Record<string, unknown>[];
  return list.slice(0, 20).map((j) => ({
    id: String(j.id ?? ""),
    title: String(j.title || "Formulario sin título"),
    total: Number(j.total) || 0,
    sent: Number(j.sent) || 0,
    failed: Number(j.failed) || 0,
    status: String(j.status || ""),
    createdAt: String(j.createdAt ?? j.created_at ?? ""),
  }));
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("es-PE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function MiCuentaClient() {
  const { me } = useMe();
  const settings = usePublicSettings();
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [code, setCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [redeemMsg, setRedeemMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [orders, setOrders] = useState<OrderRow[] | null>(null);

  useEffect(() => {
    if (!me) return;
    fetch("/api/web/jobs", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setJobs(normalizeJobs(d)))
      .catch(() => setJobs([]));
    fetch("/api/web/orders", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setOrders(Array.isArray(d?.orders) ? (d.orders as OrderRow[]) : []))
      .catch(() => setOrders([]));
  }, [me]);

  async function redeem(e: React.FormEvent) {
    e.preventDefault();
    const clean = code.trim();
    if (!clean || redeeming) return;
    setRedeeming(true);
    setRedeemMsg(null);
    try {
      const res = await fetch("/api/web/coupons/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: clean }),
      });
      const d = await res.json().catch(() => ({}));
      if (d.ok) {
        setRedeemMsg({ ok: true, text: `Listo: sumaste ${Number(d.creditsAdded) || 0} créditos.` });
        setCode("");
        announceBalanceChange();
      } else {
        setRedeemMsg({ ok: false, text: String(d.message || d.reason || "No se pudo aplicar el cupón.") });
      }
    } catch {
      setRedeemMsg({ ok: false, text: "No se pudo conectar con el servidor." });
    } finally {
      setRedeeming(false);
    }
  }

  async function logout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/me", { method: "POST" });
    } finally {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/";
    }
  }

  if (me === undefined) {
    return (
      <div className="sheet">
        <div className="sheet-body">
          <p className="sheet-lead">Cargando tu cuenta…</p>
        </div>
      </div>
    );
  }

  if (me === null) {
    return (
      <div className="sheet">
        <div className="sheet-body">
          <SignInCard next="/mi-cuenta" freeCredits={settings.freeSignupCredits} title="Inicia sesión para ver tu cuenta" />
        </div>
      </div>
    );
  }

  return (
    <div className="sheet">
      <div className="sheet-body">
        <div className="who">
          <p className="who-name">{me.name || me.email}</p>
          <p className="who-mail">{me.email}</p>
        </div>

        {(orders ?? [])
          .filter((o) => o.status === "refunded" && o.refunded_at && Date.now() - Date.parse(o.refunded_at) < 14 * 86400_000)
          .map((o) => (
            <div className="note note-warn" role="status" key={`r-${o.order_id}`}>
              <p>
                <strong>Te devolvimos {fmtPen(o.amount_cents)}</strong> del pedido {o.order_id} ({fmtDate(o.refunded_at ?? "")}).
                {o.refund_reason ? ` Motivo: ${o.refund_reason}` : ""} Se retiraron de tu saldo los créditos de esa compra que
                aún tenías.
              </p>
            </div>
          ))}

        <div className="balances">
          <div className="balance">
            <p className="balance-label">Créditos comprados</p>
            <p className="balance-value">{me.credits}</p>
            <p className="balance-note">Sirven para IA, fila prioritaria y formularios grandes.</p>
          </div>
          <div className="balance">
            <p className="balance-label">Respuestas gratis</p>
            <p className="balance-value">{me.freeCredits}</p>
            <p className="balance-note">De bienvenida, solo en modo aleatorio o fijo.</p>
          </div>
        </div>
        <div className="actions">
          <Link className="b b-primary" href="/comprar-creditos">
            Comprar créditos
          </Link>
          <Link className="b b-ghost" href="/">
            Ir a la herramienta
          </Link>
        </div>

        <form className="group" onSubmit={redeem}>
          <h3>Canjear un cupón</h3>
          <div className="inline-field">
            <label className="sr" htmlFor="coupon">
              Código del cupón
            </label>
            <input
              id="coupon"
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              maxLength={40}
              placeholder="Código del cupón"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button type="submit" className="b b-primary" disabled={!code.trim() || redeeming}>
              {redeeming ? "Canjeando…" : "Canjear"}
            </button>
          </div>
          {redeemMsg && (
            <p className={redeemMsg.ok ? "msg msg-ok" : "msg msg-err"} role="status">
              {redeemMsg.text}
            </p>
          )}
        </form>

        <section className="group" aria-labelledby="orders-h">
          <h3 id="orders-h">Tus compras</h3>
          {orders === null && <p className="fine">Cargando…</p>}
          {orders && orders.length === 0 && <p className="fine">Todavía no compraste créditos.</p>}
          {orders && orders.length > 0 && (
            <ul className="jobs">
              {orders.map((o) => (
                <li key={o.order_id}>
                  <div>
                    <p className="job-title">
                      {o.credits} créditos por {fmtPen(o.amount_cents)}
                    </p>
                    <p className="job-meta">
                      {o.order_id}, {fmtDate(o.paid_at ?? o.created_at)}
                      {o.status === "refunded" && o.refund_reason ? `. Motivo de la devolución: ${o.refund_reason}` : ""}
                    </p>
                  </div>
                  <span className={`status status-${o.status === "refunded" ? "failed" : "done"}`}>
                    {o.status === "refunded" ? "Devuelto" : "Pagado"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="group" aria-labelledby="jobs-h">
          <h3 id="jobs-h">Tus envíos recientes</h3>
          {jobs === null && <p className="fine">Cargando…</p>}
          {jobs && jobs.length === 0 && (
            <p className="fine">
              Todavía no enviaste ningún formulario. <Link href="/">Empieza con uno</Link>.
            </p>
          )}
          {jobs && jobs.length > 0 && (
            <ul className="jobs">
              {jobs.map((j) => (
                <li key={j.id}>
                  <div>
                    <p className="job-title">{j.title}</p>
                    <p className="job-meta">
                      {fmtDate(j.createdAt)}
                      {j.createdAt ? ", " : ""}
                      {j.sent} de {j.total} enviadas{j.failed > 0 ? `, ${j.failed} con error` : ""}
                    </p>
                  </div>
                  <span className={`status status-${j.status}`}>{STATUS_LABEL[j.status] ?? j.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="group">
          <button type="button" className="b b-ghost" onClick={logout} disabled={loggingOut}>
            {loggingOut ? "Cerrando sesión…" : "Cerrar sesión"}
          </button>
        </div>
      </div>
    </div>
  );
}
