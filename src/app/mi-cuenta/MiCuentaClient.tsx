"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { announceBalanceChange, fmtPen, safeNextPath, useMe, usePublicSettings } from "../clientData";
import { SignInCard } from "../SignIn";
import PrivacyPanel from "./PrivacyPanel";
import ExportButton from "../ExportButton";
import { openSupportChat } from "../SupportButton";
import { Rich, useLang } from "../LangProvider";

const SEEN_REFUNDS_KEY = "fb-seen-refunds";
type Tab = "resumen" | "envios" | "compras" | "privacidad";
const TABS: { id: Tab; label: string }[] = [
  { id: "resumen", label: "Resumen" },
  { id: "envios", label: "Mis envíos" },
  { id: "compras", label: "Mis compras" },
  { id: "privacidad", label: "Privacidad" },
];

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
  isPaid: boolean;
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
    isPaid: j.is_paid === true || j.isPaid === true,
    createdAt: String(j.createdAt ?? j.created_at ?? ""),
  }));
}

function fmtDate(iso: string, locale = "es"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const noSubscribe = () => () => {};

/** Devoluciones que este navegador aún no mostró (se avisan una sola vez). */
function unseenRefunds(orders: OrderRow[]): OrderRow[] {
  const refunded = orders.filter((o) => o.status === "refunded");
  if (!refunded.length) return [];
  try {
    const seen = new Set<string>(JSON.parse(localStorage.getItem(SEEN_REFUNDS_KEY) || "[]"));
    const fresh = refunded.filter((o) => !seen.has(o.order_id));
    const all = [...new Set([...seen, ...refunded.map((o) => o.order_id)])].slice(-100);
    localStorage.setItem(SEEN_REFUNDS_KEY, JSON.stringify(all));
    return fresh;
  } catch {
    return [];
  }
}

/** ?volver=/ruta (desde "Iniciar sesión" del menú): a dónde volver tras entrar. */
function useVolver(): string {
  return useSyncExternalStore(
    noSubscribe,
    () => {
      const v = new URLSearchParams(window.location.search).get("volver");
      return v ? safeNextPath(v) : "";
    },
    () => ""
  );
}

export default function MiCuentaClient() {
  const { me, refresh } = useMe();
  const { locale, tr } = useLang();
  const volver = useVolver();
  const settings = usePublicSettings();
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [code, setCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [redeemMsg, setRedeemMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [freshRefunds, setFreshRefunds] = useState<OrderRow[]>([]);
  const [tab, setTab] = useState<Tab>("resumen");

  useEffect(() => {
    if (!me) return;
    fetch("/api/web/jobs", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setJobs(normalizeJobs(d)))
      .catch(() => setJobs([]));
    fetch("/api/web/orders", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list = Array.isArray(d?.orders) ? (d.orders as OrderRow[]) : [];
        setOrders(list);
        // El aviso de devolución sale una vez; luego queda solo en "Mis compras".
        setFreshRefunds(unseenRefunds(list));
      })
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
        setRedeemMsg({ ok: true, text: tr("Listo: sumaste {n} créditos.", { n: Number(d.creditsAdded) || 0 }) });
        setCode("");
        announceBalanceChange();
      } else {
        setRedeemMsg({ ok: false, text: String(d.message || d.reason || tr("No se pudo aplicar el cupón.")) });
      }
    } catch {
      setRedeemMsg({ ok: false, text: tr("No se pudo conectar con el servidor.") });
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
          <p className="sheet-lead">{tr("Cargando tu cuenta…")}</p>
        </div>
      </div>
    );
  }

  if (me === null) {
    return (
      <div className="sheet">
        <div className="sheet-body">
          <SignInCard next={volver || "/mi-cuenta"} freeCredits={settings.freeSignupCredits} title={tr("Inicia sesión para ver tu cuenta")} />
        </div>
      </div>
    );
  }

  const done = (jobs ?? []).filter((j) => j.status === "done" || j.status === "failed" || j.status === "rejected");
  const totalSent = (jobs ?? []).reduce((n, j) => n + j.sent, 0);
  const paidOrders = (orders ?? []).filter((o) => o.status === "paid");
  const initial = (me.name || me.email).trim().charAt(0).toUpperCase();
  // Recarga en un clic: el último paquete que compró, ya elegido en la tienda.
  const lastPaid = (orders ?? []).find((o) => o.status === "paid");
  const rechargeIdx = lastPaid ? settings.creditPackages.findIndex((p) => p.responses === lastPaid.credits) : -1;
  const rechargePack = rechargeIdx >= 0 ? settings.creditPackages[rechargeIdx] : null;
  const rechargeHref = `/comprar-creditos${rechargeIdx >= 0 ? `?paquete=${rechargeIdx}` : ""}`;

  const jobsList = (limit?: number) => (
    <>
      {jobs === null && <p className="fine">{tr("Cargando…")}</p>}
      {jobs && jobs.length === 0 && (
        <p className="fine">
          <Rich text={tr("Todavía no enviaste ningún formulario. <go>Empieza con uno</go>.")} tags={{ go: (c) => <Link href="/">{c}</Link> }} />
        </p>
      )}
      {jobs && jobs.length > 0 && (
        <ul className="jobs">
          {jobs.slice(0, limit ?? jobs.length).map((j) => {
            const finished = j.status === "done" || j.status === "failed" || j.status === "rejected";
            const back = finished ? j.total - j.sent : 0;
            return (
              <li key={j.id}>
                <div>
                  <p className="job-title">{j.title === "Formulario sin título" ? tr(j.title) : j.title}</p>
                  <p className="job-meta">
                    {fmtDate(j.createdAt, locale)}
                    {j.createdAt ? " · " : ""}
                    {tr("{s} de {t} enviadas", { s: j.sent, t: j.total })}
                    {j.failed > 0 ? tr(" · {n} con error", { n: j.failed }) : ""}
                    {back > 0 ? (j.isPaid ? tr(" · se devolvieron {n} créditos", { n: back }) : tr(" · se devolvieron {n} respuestas gratis", { n: back })) : ""}
                  </p>
                </div>
                <div className="job-side">
                  <span className={`status status-${j.status}`}>{STATUS_LABEL[j.status] ? tr(STATUS_LABEL[j.status]) : j.status}</span>
                  {j.sent > 0 && <ExportButton jobId={j.id} premium={me.hasPaid} small />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );

  return (
    <div className="sheet acct">
      <div className="acct-head">
        <span className="acct-avatar" aria-hidden="true">
          {initial}
        </span>
        <div className="acct-id">
          <p className="acct-name">{me.name || tr("Tu cuenta")}</p>
          <p className="acct-mail">{me.email}</p>
          <p className="acct-badges">
            <span className={me.hasPaid ? "acct-badge acct-badge-pro" : "acct-badge"}>{me.hasPaid ? tr("Cliente con créditos") : tr("Plan gratis")}</span>
          </p>
        </div>
        <div className="acct-head-actions">
          <Link className="b b-primary b-small" href="/comprar-creditos">
            {tr("Comprar créditos")}
          </Link>
          <button type="button" className="b b-ghost b-small" onClick={openSupportChat}>
            {tr("Mensajes")}
          </button>
        </div>
      </div>

      <div className="acct-stats">
        <div>
          <strong>{me.credits}</strong>
          <span>{tr("Créditos")}</span>
        </div>
        <div>
          <strong>{me.freeCredits}</strong>
          <span>{tr("Respuestas gratis")}</span>
        </div>
        <div>
          <strong>{jobs ? jobs.length : "…"}</strong>
          <span>{tr("Envíos")}</span>
        </div>
        <div>
          <strong>{jobs ? totalSent : "…"}</strong>
          <span>{tr("Respuestas enviadas")}</span>
        </div>
      </div>

      <div className="acct-tabs" role="tablist" aria-label={tr("Secciones de tu cuenta")}>
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
            {tr(t.label)}
          </button>
        ))}
      </div>

      <div className="sheet-body">
        {freshRefunds.map((o) => (
          <div className="note note-warn acct-notice" role="status" key={`r-${o.order_id}`}>
            <p>
              <Rich text={tr("<b>Te devolvimos {amount}</b> del pedido {id} ({date}).", { amount: fmtPen(o.amount_cents), id: o.order_id, date: fmtDate(o.refunded_at ?? "", locale) })} />
              {o.refund_reason ? tr(" Motivo: {r}", { r: o.refund_reason }) : ""}
              {tr(" Se retiraron de tu saldo los créditos de esa compra que aún tenías.")}
            </p>
            <button
              type="button"
              className="acct-notice-x"
              aria-label={tr("Cerrar aviso")}
              onClick={() => setFreshRefunds((l) => l.filter((x) => x.order_id !== o.order_id))}
            >
              ×
            </button>
          </div>
        ))}

        {tab === "resumen" && (
          <>
            {me.hasPaid && settings.lowCreditsThreshold > 0 && me.credits < settings.lowCreditsThreshold && (
              <div className="note note-warn acct-low" role="status">
                <p>
                  <strong>{me.credits > 0 ? tr("Te quedan {n} créditos.", { n: me.credits }) : tr("Te quedaste sin créditos.")}</strong>
                  {tr(" Recarga antes de tu próxima prueba para que no se quede a medias.")}
                </p>
                <Link className="b b-primary b-small" href={rechargeHref}>
                  {rechargePack ? tr("Recargar {n} créditos", { n: rechargePack.responses }) : tr("Recargar")}
                </Link>
              </div>
            )}
            <div className="balances">
              <div className="balance">
                <p className="balance-label">{tr("Créditos")}</p>
                <p className="balance-value">{me.credits}</p>
                <p className="balance-note">{tr("Comprados o regalados. Sirven para IA, fila prioritaria y formularios grandes. No vencen.")}</p>
              </div>
              <div className="balance">
                <p className="balance-label">{tr("Respuestas gratis")}</p>
                <p className="balance-value">{me.freeCredits}</p>
                <p className="balance-note">{tr("De bienvenida, solo en modo aleatorio o fijo.")}</p>
              </div>
            </div>

            <form className="group" onSubmit={redeem}>
              <h3>{tr("Canjear un cupón")}</h3>
              <div className="inline-field">
                <label className="sr" htmlFor="coupon">
                  {tr("Código del cupón")}
                </label>
                <input
                  id="coupon"
                  type="text"
                  autoComplete="off"
                  autoCapitalize="characters"
                  maxLength={40}
                  placeholder={tr("Código del cupón")}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
                <button type="submit" className="b b-primary" disabled={!code.trim() || redeeming}>
                  {redeeming ? tr("Canjeando…") : tr("Canjear")}
                </button>
              </div>
              {redeemMsg && (
                <p className={redeemMsg.ok ? "msg msg-ok" : "msg msg-err"} role="status">
                  {tr(redeemMsg.text)}
                </p>
              )}
            </form>

            {settings.referral && (
              <Link className="ref-card" href="/invita">
                <span className="ref-card-ico" aria-hidden="true">🎁</span>
                <span>
                  <strong>{tr("Invita y gana {n} créditos", { n: settings.referral.referrerCredits })}</strong>
                  <small>{tr("Por cada persona que se registre con tu enlace y haga su primera compra.")}</small>
                </span>
                <span aria-hidden="true">→</span>
              </Link>
            )}

            <section className="group" aria-labelledby="recent-h">
              <div className="acct-sec-head">
                <h3 id="recent-h">{tr("Últimos envíos")}</h3>
                {jobs && jobs.length > 3 && (
                  <button type="button" className="linkish" onClick={() => setTab("envios")}>
                    {tr("Ver todos ({n})", { n: jobs.length })}
                  </button>
                )}
              </div>
              {jobsList(3)}
            </section>

            <div className="actions">
              <Link className="b b-primary" href="/">
                {tr("Ir a la herramienta")}
              </Link>
            </div>
          </>
        )}

        {tab === "envios" && (
          <section aria-labelledby="jobs-h">
            <h3 id="jobs-h">{tr("Mis envíos")}</h3>
            <p className="fine">
              {tr("{n} terminados. Lo que no llega a tu formulario se devuelve solo a tu saldo. Con créditos puedes descargar el Excel de cada envío.", { n: done.length })}
            </p>
            {jobsList()}
          </section>
        )}

        {tab === "compras" && (
          <section aria-labelledby="orders-h">
            <h3 id="orders-h">{tr("Mis compras")}</h3>
            {orders === null && <p className="fine">{tr("Cargando…")}</p>}
            {orders && orders.length === 0 && (
              <p className="fine">
                <Rich text={tr("Todavía no compraste créditos. <go>Ver paquetes</go>.")} tags={{ go: (c) => <Link href="/comprar-creditos">{c}</Link> }} />
              </p>
            )}
            {orders && orders.length > 0 && (
              <>
                <p className="fine">
                  {tr(paidOrders.length === 1 ? "{n} compra · {total} en total" : "{n} compras · {total} en total", {
                    n: paidOrders.length,
                    total: fmtPen(paidOrders.reduce((n, o) => n + o.amount_cents, 0)),
                  })}
                </p>
                <ul className="jobs">
                  {orders.map((o) => (
                    <li key={o.order_id}>
                      <div>
                        <p className="job-title">
                          {tr("{n} créditos por {amount}", { n: o.credits, amount: fmtPen(o.amount_cents) })}
                        </p>
                        <p className="job-meta">
                          {tr("Pedido {id} · {date}", { id: o.order_id, date: fmtDate(o.paid_at ?? o.created_at, locale) })}
                          {o.status === "refunded" && o.refund_reason ? tr(" · Motivo de la devolución: {r}", { r: o.refund_reason }) : ""}
                        </p>
                      </div>
                      <span className={`status status-${o.status === "refunded" ? "failed" : "done"}`}>
                        {o.status === "refunded" ? tr("Devuelto") : tr("Pagado")}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <p className="fine">
              {tr("¿Un pago no se reflejó o quedó pendiente?")}{" "}
              <button type="button" className="linkish" onClick={openSupportChat}>
                {tr("Escríbenos por Mensajes")}
              </button>
              .
            </p>
          </section>
        )}

        {tab === "privacidad" && (
          <>
            <PrivacyPanel me={me} onChange={refresh} />
            <div className="group">
              <button type="button" className="b b-ghost" onClick={logout} disabled={loggingOut}>
                {loggingOut ? tr("Cerrando sesión…") : tr("Cerrar sesión")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
