"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fmtPen, useMe, usePublicSettings } from "../clientData";
import { SignInCard } from "../SignIn";

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

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString("es-PE", { day: "numeric", month: "short", year: "numeric" });
}

/** "Invita y gana": enlace para compartir, cómo funciona y a quién invitaste. */
export default function InvitaClient() {
  const { me } = useMe();
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

  if (me === undefined) return <div className="sheet"><div className="sheet-body"><p className="sheet-lead">Cargando…</p></div></div>;
  if (me === null) {
    return (
      <div className="sheet">
        <div className="sheet-body">
          <SignInCard next="/invita" freeCredits={settings.freeSignupCredits} title="Inicia sesión para invitar" />
        </div>
      </div>
    );
  }
  if (failed) return <div className="sheet"><div className="sheet-body"><p className="msg msg-err">No se pudo cargar. Recarga la página.</p></div></div>;
  if (!data) return <div className="sheet"><div className="sheet-body"><p className="sheet-lead">Cargando…</p></div></div>;
  if (!data.enabled) {
    return (
      <div className="sheet">
        <div className="sheet-body">
          <p className="sheet-lead">El programa de invitaciones no está activo en este momento. Vuelve pronto.</p>
          <Link className="b b-primary" href="/">Ir a la herramienta</Link>
        </div>
      </div>
    );
  }

  const r = data.rules;
  const share = `Prueba tu Google Form antes de mandarlo con FormsBot. Con mi enlace ganas ${r.referredCredits} créditos extra en tu primera compra: ${data.link}`;

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
          <span>créditos para ti</span>
        </div>
        <div className="ref-plus" aria-hidden="true">+</div>
        <div className="ref-gift">
          <strong>+{r.referredCredits}</strong>
          <span>para tu invitado</span>
        </div>
      </div>

      <div className="sheet-body">
        <label className="ref-label" htmlFor="ref-link">
          Tu enlace
        </label>
        <div className="inline-field">
          <input id="ref-link" type="text" readOnly value={data.link} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="b b-primary" onClick={copy}>
            {copied ? "¡Copiado!" : "Copiar"}
          </button>
        </div>
        <div className="ref-share">
          <a className="b b-ghost b-small" href={`https://wa.me/?text=${encodeURIComponent(share)}`} target="_blank" rel="noopener noreferrer">
            Compartir por WhatsApp
          </a>
          <a className="b b-ghost b-small" href={`https://t.me/share/url?url=${encodeURIComponent(data.link ?? "")}&text=${encodeURIComponent(share)}`} target="_blank" rel="noopener noreferrer">
            Telegram
          </a>
        </div>

        <div className="acct-stats ref-stats">
          <div><strong>{data.stats?.registered ?? 0}</strong><span>Se registraron</span></div>
          <div><strong>{data.stats?.purchased ?? 0}</strong><span>Compraron</span></div>
          <div><strong>{data.stats?.earned ?? 0}</strong><span>Créditos ganados</span></div>
          <div><strong>{data.stats?.thisMonth ?? 0}/{r.monthlyCap}</strong><span>Premios este mes</span></div>
        </div>

        <section className="group">
          <h3>Cómo funciona</h3>
          <ol className="ref-steps">
            <li>Comparte tu enlace con quien necesite probar su formulario.</li>
            <li>
              Tu invitado crea su cuenta entrando por tu enlace. El enlace le vale <b>{r.days} días</b> desde que lo abre.
            </li>
            <li>
              Cuando hace su primera compra de {fmtPen(r.minPurchaseCents)} o más, tú recibes <b>{r.referrerCredits} créditos</b> y tu invitado{" "}
              <b>{r.referredCredits} créditos</b> extra, al instante.
            </li>
          </ol>
          <ul className="ref-rules">
            <li>Cada invitado te da premio <b>una sola vez</b> (en su primera compra de {fmtPen(r.minPurchaseCents)} o más), y él recibe su regalo una sola vez.</li>
            <li>Hasta <b>{r.monthlyCap} premios por mes</b>.</li>
            <li>No cuentan tus propias cuentas, las creadas desde tu misma conexión ni correos que ya tuvieron cuenta.</li>
            <li>Si la compra se devuelve, el premio se retira. Los créditos de premio no se cambian por dinero.</li>
          </ul>
          <p className="fine">
            <a href="/terminos-herramienta.html#referidos" target="_blank" rel="noopener">
              Términos y condiciones de Invita y gana
            </a>
          </p>
        </section>

        <section className="group" aria-labelledby="ref-list-h">
          <h3 id="ref-list-h">Tus invitados</h3>
          {!data.invited?.length && <p className="fine">Aún nadie se registró con tu enlace. ¡Compártelo!</p>}
          {!!data.invited?.length && (
            <ul className="jobs">
              {data.invited.map((p, i) => {
                const st = STATUS[p.status] ?? { label: p.status, cls: "queued" };
                return (
                  <li key={`${p.date}-${i}`}>
                    <div>
                      <p className="job-title">{p.who}</p>
                      <p className="job-meta">
                        Se registró el {fmtDay(p.date)}
                        {p.credits > 0 ? ` · ganaste +${p.credits}` : ""}
                      </p>
                    </div>
                    <span className={`status status-${st.cls}`}>{st.label}</span>
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
