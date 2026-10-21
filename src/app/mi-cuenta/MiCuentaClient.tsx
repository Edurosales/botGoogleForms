"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { announceBalanceChange, useMe, usePublicSettings } from "../clientData";
import { SignInCard } from "../SignIn";

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

  useEffect(() => {
    if (!me) return;
    fetch("/api/web/jobs", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setJobs(normalizeJobs(d)))
      .catch(() => setJobs([]));
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
