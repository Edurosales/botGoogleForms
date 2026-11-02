"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fmtPen, useMe, usePublicSettings } from "../clientData";
import { SignInCard } from "../SignIn";
import { Rich, useLang } from "../LangProvider";

type Data = {
  enabled: boolean;
  code?: string;
  link?: string;
  rules: { referrerCredits: number; referredCredits: number; minPurchaseCents: number; monthlyCap: number; days: number };
  stats?: { registered: number; purchased: number; earned: number; thisMonth: number };
  invited?: { who: string; status: string; credits: number; date: string }[];
};

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Registrado · falta su compra", cls: "queued" },
  rewarded: { label: "Compró", cls: "done" },
  capped: { label: "Compró · tope del mes", cls: "processing" },
  reversed: { label: "Compra devuelta", cls: "failed" },
  rejected: { label: "No válida", cls: "failed" },
};

function fmtDay(iso: string, locale = "es"): string {
  return new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
}

/** "Invita y gana": enlace para compartir, cómo funciona y a quién invitaste. */
export default function InvitaClient() {
  const { me } = useMe();
  const { locale, tr } = useLang();
  const settings = usePublicSettings();
  const [data, setData] = useState<Data | null>(null);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!me) return;
    fetch("/api/web/referrals", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (d?.ok ? setData(d as Data) : setFailed(true)))
      .catch(() => setFailed(true));
  }, [me]);

  if (me === undefined) return <div className="sheet"><div className="sheet-body"><p className="sheet-lead">{tr("Cargando…")}</p></div></div>;
  if (me === null) {
    return (
      <div className="sheet">
        <div className="sheet-body">
          <SignInCard next="/invita" freeCredits={settings.freeSignupCredits} title={tr("Inicia sesión para invitar")} />
        </div>
      </div>
    );
  }
  if (failed) return <div className="sheet"><div className="sheet-body"><p className="msg msg-err">{tr("No se pudo cargar. Recarga la página.")}</p></div></div>;
  if (!data) return <div className="sheet"><div className="sheet-body"><p className="sheet-lead">{tr("Cargando…")}</p></div></div>;
  if (!data.enabled) {
    return (
      <div className="sheet">
        <div className="sheet-body">
          <p className="sheet-lead">{tr("El programa de invitaciones no está activo en este momento. Vuelve pronto.")}</p>
          <Link className="b b-primary" href="/">{tr("Ir a la herramienta")}</Link>
        </div>
      </div>
    );
  }

  const r = data.rules;
  const share = tr("Prueba tu Google Form antes de mandarlo con FormsBot. Con mi enlace ganas {n} créditos extra en tu primera compra: {link}", {
    n: r.referredCredits,
    link: data.link ?? "",
  });

  async function copy() {
    try {
      await navigator.clipboard.writeText(data!.link ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* el usuario puede copiarlo a mano */
    }
  }

  return (
    <div className="sheet ref">
      <div className="ref-hero">
        <div className="ref-gift">
          <strong>+{r.referrerCredits}</strong>
          <span>{tr("créditos para ti")}</span>
        </div>
        <div className="ref-plus" aria-hidden="true">+</div>
        <div className="ref-gift">
          <strong>+{r.referredCredits}</strong>
          <span>{tr("para tu invitado")}</span>
        </div>
      </div>

      <div className="sheet-body">
        <label className="ref-label" htmlFor="ref-link">
          {tr("Tu enlace")}
        </label>
        <div className="inline-field">
          <input id="ref-link" type="text" readOnly value={data.link} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="b b-primary" onClick={copy}>
            {copied ? tr("¡Copiado!") : tr("Copiar")}
          </button>
        </div>
        <div className="ref-share">
          <a className="b b-ghost b-small" href={`https://wa.me/?text=${encodeURIComponent(share)}`} target="_blank" rel="noopener noreferrer">
            {tr("Compartir por WhatsApp")}
          </a>
          <a className="b b-ghost b-small" href={`https://t.me/share/url?url=${encodeURIComponent(data.link ?? "")}&text=${encodeURIComponent(share)}`} target="_blank" rel="noopener noreferrer">
            Telegram
          </a>
        </div>

        <div className="acct-stats ref-stats">
          <div><strong>{data.stats?.registered ?? 0}</strong><span>{tr("Se registraron")}</span></div>
          <div><strong>{data.stats?.purchased ?? 0}</strong><span>{tr("Compraron")}</span></div>
          <div><strong>{data.stats?.earned ?? 0}</strong><span>{tr("Créditos ganados")}</span></div>
          <div><strong>{data.stats?.thisMonth ?? 0}/{r.monthlyCap}</strong><span>{tr("Premios este mes")}</span></div>
        </div>

        <section className="group">
          <h3>{tr("Cómo funciona")}</h3>
          <ol className="ref-steps">
            <li>{tr("Comparte tu enlace con quien necesite probar su formulario.")}</li>
            <li>
              <Rich text={tr("Tu invitado crea su cuenta entrando por tu enlace. El enlace le vale <b>{d} días</b> desde que lo abre.", { d: r.days })} />
            </li>
            <li>
              <Rich
                text={tr("Cuando hace su primera compra de {min} o más, tú recibes <b>{a} créditos</b> y tu invitado <b>{b} créditos</b> extra, al instante.", {
                  min: fmtPen(r.minPurchaseCents),
                  a: r.referrerCredits,
                  b: r.referredCredits,
                })}
              />
            </li>
          </ol>
          <ul className="ref-rules">
            <li>
              <Rich text={tr("Cada invitado te da premio <b>una sola vez</b> (en su primera compra de {min} o más), y él recibe su regalo una sola vez.", { min: fmtPen(r.minPurchaseCents) })} />
            </li>
            <li>
              <Rich text={tr("Hasta <b>{n} premios por mes</b>.", { n: r.monthlyCap })} />
            </li>
            <li>{tr("Solo vale para cuentas nuevas. No cuentan tus propias cuentas ni correos que ya tuvieron cuenta.")}</li>
            <li>{tr("Si la compra se devuelve, el premio se retira. Los créditos de premio no se cambian por dinero.")}</li>
          </ul>
          <p className="fine">
            <a href="/terminos-herramienta.html#referidos" target="_blank" rel="noopener">
              {tr("Términos y condiciones de Invita y gana")}
            </a>
          </p>
        </section>

        <section className="group" aria-labelledby="ref-list-h">
          <h3 id="ref-list-h">{tr("Tus invitados")}</h3>
          {!data.invited?.length && <p className="fine">{tr("Aún nadie se registró con tu enlace. ¡Compártelo!")}</p>}
          {!!data.invited?.length && (
            <ul className="jobs">
              {data.invited.map((p, i) => {
                const st = STATUS[p.status] ?? { label: p.status, cls: "queued" };
                return (
                  <li key={`${p.date}-${i}`}>
                    <div>
                      <p className="job-title">{p.who === "Cuenta eliminada" ? tr(p.who) : p.who}</p>
                      <p className="job-meta">
                        {tr("Se registró el {date}", { date: fmtDay(p.date, locale) })}
                        {p.credits > 0 ? tr(" · ganaste +{n}", { n: p.credits }) : ""}
                      </p>
                    </div>
                    <span className={`status status-${st.cls}`}>{tr(st.label)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
