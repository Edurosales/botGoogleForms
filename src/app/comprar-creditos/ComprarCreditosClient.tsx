"use client";

/**
 * Tienda: elegir el paquete. Los paquetes van en tarjetas verticales (como
 * las páginas de precios profesionales) con el ahorro REAL frente al paquete
 * chico. Al pulsar "Comprar" se va a la página de pago
 * (/comprar-creditos/pagar), que reemplaza a la antigua ventana emergente.
 */
import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { announceBalanceChange, fmtPen, useDailyLimits, useMe, usePublicSettings, whatsappLink, SoftwareButton } from "../clientData";
import PurchaseCelebration from "../PurchaseCelebration";
import CreditCalculator from "./CreditCalculator";
import StoreTrust from "./StoreTrust";
import { packSavings } from "./savings";
import { Rich, useLang } from "../LangProvider";

type Capacity = {
  globalCap: number;
  globalUsed: number;
  globalRemaining: number;
  perUserDaily: number;
  userUsed: number | null;
  userRemaining: number | null;
  testPayments: boolean;
};
type Pkg = { responses: number; priceCents: number };

function Check() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z" />
    </svg>
  );
}

export default function ComprarCreditosClient({ packages: serverPackages }: { packages: Pkg[] }) {
  const { tr } = useLang();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { me } = useMe();
  const { limits: daily } = useDailyLimits(Boolean(me));
  const settings = usePublicSettings();

  const packages = useMemo(
    () => (serverPackages.length ? serverPackages : settings.creditPackages).filter((p) => p.responses > 0 && p.priceCents > 0),
    [serverPackages, settings.creditPackages]
  );

  // El paquete con menor precio por respuesta se marca como el de mejor precio.
  const bestIndex = useMemo(() => {
    let best = -1;
    let bestRate = Infinity;
    packages.forEach((p, i) => {
      const rate = p.priceCents / p.responses;
      if (rate < bestRate) {
        bestRate = rate;
        best = i;
      }
    });
    return packages.length > 1 ? best : -1;
  }, [packages]);

  const [capacity, setCapacity] = useState<Capacity | null>(null);
  useEffect(() => {
    fetch("/api/web/capacity", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => d?.ok && setCapacity(d as Capacity))
      .catch(() => {});
  }, []);
  const serviceFull = !!capacity && capacity.globalRemaining <= 0;

  const [diyUrl, setDiyUrl] = useState("");
  const [diyCount, setDiyCount] = useState(50);

  const volver = !!searchParams.get("volver");
  const paidOrder = searchParams.get("pagado");
  const errorParam = searchParams.get("error");
  const cupon = (searchParams.get("cupon") ?? "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 40);
  // Pagos que vuelven con error a la tienda (enlaces viejos): se manda a la página de pago.
  const mpParam = searchParams.get("mp");

  useEffect(() => {
    if (paidOrder) announceBalanceChange();
  }, [paidOrder]);

  // ?paquete=N (recarga en un clic, correo "termina tu compra" con cupón) o un rechazo:
  // directo a la página de pago, con el paquete y el cupón ya puestos.
  useEffect(() => {
    if (paidOrder) return;
    const wanted = searchParams.get("paquete");
    if (mpParam || wanted !== null) {
      const qs = new URLSearchParams(searchParams.toString());
      router.replace(`/comprar-creditos/pagar?${qs.toString()}`);
    }
  }, [mpParam, cupon, paidOrder, router, searchParams]);

  const buyLeft = daily?.purchases.left ?? Infinity;
  const perDay = capacity?.perUserDaily ?? 500;

  function buy(i: number) {
    const qs = new URLSearchParams({ paquete: String(i) });
    if (volver) qs.set("volver", "1");
    if (cupon) qs.set("cupon", cupon);
    router.push(`/comprar-creditos/pagar?${qs.toString()}`);
  }

  const diyHref = whatsappLink(
    settings.whatsappNumber,
    diyUrl.trim()
      ? tr("Hola, quiero que llenen mi formulario: {url}. Necesito {n} respuestas.", { url: diyUrl.trim(), n: diyCount })
      : tr("Hola, quiero que llenen mi formulario. Necesito {n} respuestas.", { n: diyCount })
  );

  const features = [
    tr("Respuestas con IA"),
    tr("Sin fila: envío al instante"),
    tr("Formularios de hasta {n} preguntas", { n: settings.maxPaidQuestions }),
    tr("Los créditos no vencen"),
    tr("Devolución automática de lo que no llega"),
  ];

  return (
    <div className="buy">
      <PurchaseCelebration orderId={paidOrder} onUse={() => router.push("/")} />
      {paidOrder && (
        <div className="note note-ok" role="status">
          <p>
            <Rich text={tr("<b>Pago confirmado.</b> El pedido {id} ya sumó créditos a tu cuenta.", { id: paidOrder })} />
          </p>
        </div>
      )}
      {errorParam && (
        <div className="note note-err" role="alert">
          <p>{tr("No se pudo confirmar el pago. Si se te descontó, escríbenos por WhatsApp con la hora del intento y lo revisamos.")}</p>
        </div>
      )}
      {capacity?.testPayments && (
        <div className="note note-warn" role="status">
          <p>
            <Rich text={tr("<b>Pagos en modo prueba.</b> Esta tienda usa credenciales de prueba de Izipay: ningún pago es real y no se entregan créditos.")} />
          </p>
        </div>
      )}
      {serviceFull && (
        <div className="note note-warn" role="alert">
          <p>
            <Rich
              text={tr(
                "<b>El servicio llegó a su capacidad de hoy.</b> La compra se reabre en unas horas; mientras tanto puedes pedir que llenemos tu formulario por WhatsApp o usar FormsBot para Windows."
              )}
            />
          </p>
        </div>
      )}
      {settings.purchasesPaused && (
        <div className="note note-warn" role="status">
          <p>{settings.purchasesPauseMessage || tr("Las compras están en pausa por mantenimiento. Vuelve en un rato; tus créditos están seguros.")}</p>
        </div>
      )}

      {me && (
        <p className="fine store-me">
          <Rich
            text={
              me.freeCredits > 0
                ? tr("Comprando como <b>{email}</b>. Saldo actual: {n} créditos y {f} respuestas gratis.", { email: me.email, n: me.credits, f: me.freeCredits })
                : tr("Comprando como <b>{email}</b>. Saldo actual: {n} créditos.", { email: me.email, n: me.credits })
            }
          />
        </p>
      )}

      {packages.length === 0 && <p className="fine">{tr("Todavía no hay paquetes disponibles. Escríbenos por WhatsApp y te ayudamos.")}</p>}

      <div className="tiers" role="list" aria-label={tr("Paquetes de créditos")}>
        {packages.map((p, i) => {
          const tooBig = p.responses > buyLeft;
          const save = packSavings(packages, p);
          const best = i === bestIndex;
          return (
            <article key={`${p.responses}-${p.priceCents}`} role="listitem" className={`tier${best ? " tier-best" : ""}${tooBig ? " tier-off" : ""}`}>
              {best && <p className="tier-ribbon">{tr("Mejor precio")}</p>}
              <h2 className="tier-qty">
                {p.responses}
                <span>{tr("respuestas")}</span>
              </h2>
              <div className="tier-price">
                {save && (
                  <p className="tier-was">
                    <s>{fmtPen(save.refCents)}</s>
                    <span className="tier-off-tag">{tr("Ahorras {p}%", { p: save.percent })}</span>
                  </p>
                )}
                <p className="tier-now">{fmtPen(p.priceCents)}</p>
                <p className="tier-rate">{tr("{p} por respuesta", { p: fmtPen(p.priceCents / p.responses) })}</p>
                {save && <p className="tier-ref">{tr("Comparado con comprar a {p} c/u", { p: fmtPen(save.baseRateCents) })}</p>}
              </div>
              <ul className="tier-feats">
                {features.map((f) => (
                  <li key={f}>
                    <Check />
                    {f}
                  </li>
                ))}
                {p.responses > perDay && (
                  <li className="tier-note">{tr("Se usa en {n} días como mínimo ({d} por día).", { n: Math.ceil(p.responses / perDay), d: perDay })}</li>
                )}
              </ul>
              <button
                type="button"
                className={`b b-block ${best ? "b-primary" : "b-ghost"} tier-cta`}
                disabled={tooBig || serviceFull || settings.purchasesPaused}
                onClick={() => buy(i)}
              >
                {tooBig ? tr("Supera tu tope de hoy") : tr("Comprar")}
              </button>
            </article>
          );
        })}
      </div>

      {daily && (
        <div className="daycount">
          <span>
            <Rich text={tr("Hoy puedes comprar <b>{left}</b> de {max} créditos", { left: daily.purchases.left, max: daily.purchases.max })} />
          </span>
          <span>
            <Rich text={tr("Hoy puedes enviar <b>{left}</b> de {max} respuestas", { left: daily.responses.left, max: daily.responses.max })} />
          </span>
        </div>
      )}

      <div className="store-calc">
        <CreditCalculator packages={packages} balance={me ? me.credits + me.freeCredits : 0} buyLeft={buyLeft} onPick={buy} />
      </div>

      <div className="trust-box">
        <p className="trust-title">{tr("Antes de comprar")}</p>
        <ul>
          <li>
            <Rich text={tr("Tu Google Form debe ser <b>público</b> (sin iniciar sesión, sin “Limitar a 1 respuesta”, sin correo verificado ni subir archivos).")} />
          </li>
          <li>
            <Rich text={tr("El servicio web llena formularios de hasta <b>{n} preguntas</b>. Para más, usa el programa de escritorio.", { n: settings.maxPaidQuestions })} />
          </li>
          <li>{tr("Si tenías respuestas gratis, al comprar se suman a tus créditos y tienen las mismas ventajas.")}</li>
          <li>{tr("Puedes enviar hasta {n} respuestas cada 24 horas por cuenta. Los créditos no vencen: un paquete grande se usa en varios días.", { n: perDay })}</li>
        </ul>
      </div>

      <StoreTrust />

      <div className="alt-ways">
        <section className="sheet" aria-labelledby="soft-h">
          <Image className="sheet-img" src="/soft.png" alt={tr("Ventana del programa FormsBot para escritorio")} width={1245} height={847} sizes="(max-width: 900px) 100vw, 480px" />
          <div className="sheet-body">
            <h2 id="soft-h">{tr("O compra el programa")}</h2>
            <p className="sheet-lead">{tr("FormsBot para Windows: sin fila, sin límite de respuestas y con tu propia IA. Pago único.")}</p>
            <SoftwareButton className="b b-ghost b-block" href={settings.buySoftwareUrl}>
              {tr("Ver el software")}
            </SoftwareButton>
          </div>
        </section>

        <section className="sheet" aria-labelledby="diy-h">
          <div className="sheet-body">
            <h2 id="diy-h">{tr("Yo lo lleno por ti")}</h2>
            <p className="sheet-lead">{tr("Mándame tu formulario y cuántas respuestas necesitas. Te respondo por WhatsApp con el precio.")}</p>
            <div className="field">
              <label htmlFor="diy-url">{tr("Link de tu formulario")}</label>
              <input id="diy-url" type="url" maxLength={500} placeholder="https://docs.google.com/forms/…" value={diyUrl} onChange={(e) => setDiyUrl(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="diy-count">{tr("Cantidad de respuestas")}</label>
              <input
                id="diy-count"
                type="number"
                min={1}
                max={5000}
                value={diyCount}
                onChange={(e) => setDiyCount(Math.min(5000, Math.max(1, Number(e.target.value) || 1)))}
              />
            </div>
            <a className="b b-wa b-block" href={diyHref} target="_blank" rel="noopener">
              {tr("Pedir por WhatsApp")}
            </a>
            <p className="fine">{tr("Tu formulario debe abrirse sin iniciar sesión y no recolectar correos verificados.")}</p>
          </div>
        </section>
      </div>
    </div>
  );
}
