"use client";

import { legalHref } from "@/lib/i18n";
import { useEffect, useMemo, useState } from "react";

type Capacity = {
  globalCap: number;
  globalUsed: number;
  globalRemaining: number;
  perUserDaily: number;
  userUsed: number | null;
  userRemaining: number | null;
  testPayments: boolean;
};
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { CREDIT_PURCHASE_CHECKS } from "@/lib/webLegal";
import { useDailyLimits } from "../clientData";
import { announceBalanceChange, fmtPen, formatPhone, useMe, usePublicSettings, whatsappLink, SoftwareButton } from "../clientData";
import { SignInCard } from "../SignIn";
import PurchaseCelebration from "../PurchaseCelebration";
import CreditCalculator from "./CreditCalculator";
import { MP_REJECT_REASONS } from "./mpReasons";
import Script from "next/script";
import { IZIPAY_BRANDS, MP_BRANDS, PayLogos, SecurePayStrip } from "./PayLogos";
import { Rich, useLang } from "../LangProvider";
import type { Locale } from "@/lib/i18n";

/** Idioma del formulario de tarjeta de Izipay. */
const IZIPAY_LANG: Record<Locale, string> = { es: "es-ES", en: "en-US", pt: "pt-BR", it: "it-IT", fr: "fr-FR" };

type Pkg = { responses: number; priceCents: number };
type Pay = {
  orderId: string;
  formToken: string;
  publicKey: string;
  staticUrl: string;
  returnUrl: string;
  amountCents?: number;
  originalCents?: number;
  credits?: number;
};
type CouponState = { status: "idle" | "checking" | "ok" | "bad"; discountPercent: number; finalCents: number; reason: string };

const IDLE_COUPON: CouponState = { status: "idle", discountPercent: 0, finalCents: 0, reason: "" };

export default function ComprarCreditosClient({ packages: serverPackages }: { packages: Pkg[] }) {
  const { t, tr, locale } = useLang();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { me } = useMe();
  const { limits: daily } = useDailyLimits(Boolean(me));
  // Tipo de cambio aproximado (solo referencia: siempre se cobra en soles).
  const [fx, setFx] = useState<Record<string, number>>({});
  useEffect(() => {
    let alive = true;
    fetch("/api/web/fx")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d?.ok) setFx(d.rates ?? {});
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
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

  const [selectedIndex, setSelectedIndex] = useState(() => {
    const wanted = Number(searchParams.get("paquete"));
    if (Number.isInteger(wanted) && wanted >= 0 && wanted < serverPackages.length) return wanted;
    return serverPackages.length > 1 ? 1 : 0;
  });
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  // ?cupon=CODIGO (enlace del correo "termina tu compra"): el cupón ya escrito.
  const [couponCode, setCouponCode] = useState(() => (searchParams.get("cupon") ?? "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 40));
  const [coupon, setCoupon] = useState<CouponState>(IDLE_COUPON);
  const [busy, setBusy] = useState(false);
  /** Medio de pago elegido (si el admin activó los dos). */
  const [method, setMethod] = useState<"izipay" | "mercadopago" | "">("");
  const [err, setErr] = useState("");
  const [pay, setPay] = useState<Pay | null>(null);
  const [formReady, setFormReady] = useState(false);

  const [capacity, setCapacity] = useState<Capacity | null>(null);
  useEffect(() => {
    fetch("/api/web/capacity", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => d?.ok && setCapacity(d as Capacity))
      .catch(() => {});
  }, []);
  // Si el servicio llegó a su tope del día, no se vende: el cliente pagaría y
  // no podría usar los créditos hasta mañana sin saberlo.
  const serviceFull = !!capacity && capacity.globalRemaining <= 0;

  const [diyUrl, setDiyUrl] = useState("");
  const [diyCount, setDiyCount] = useState(50);

  const returnTo = searchParams.get("volver") ? "/" : "/comprar-creditos";
  const paidOrder = searchParams.get("pagado");
  const errorParam = searchParams.get("error");
  const mpParam = searchParams.get("mp");
  const mpReason = searchParams.get("motivo") || "";
  const selected = packages[selectedIndex] ?? packages[0] ?? null;

  useEffect(() => {
    if (paidOrder) announceBalanceChange();
  }, [paidOrder]);

  // Validación del cupón en vivo (con pausa para no consultar en cada tecla).
  // El estado "revisando" lo ponen los manejadores de cambio; aquí solo se consulta.
  useEffect(() => {
    const code = couponCode.trim();
    if (!code || !selected) return;
    const t = setTimeout(async () => {
      try {
        const qs = new URLSearchParams({ code, packageIndex: String(selectedIndex) });
        const r = await fetch(`/api/web/coupons/validate?${qs}`, { cache: "no-store" });
        const d = await r.json().catch(() => ({}));
        if (d.ok) {
          setCoupon({
            status: "ok",
            discountPercent: Number(d.discountPercent) || 0,
            finalCents: Number(d.finalCents) || selected.priceCents,
            reason: "",
          });
        } else {
          setCoupon({ status: "bad", discountPercent: 0, finalCents: 0, reason: String(d.reason || d.message || tr("Cupón no válido.")) });
        }
      } catch {
        setCoupon({ status: "bad", discountPercent: 0, finalCents: 0, reason: tr("No se pudo validar el cupón.") });
      }
    }, 450);
    return () => clearTimeout(t);
  }, [couponCode, selectedIndex, selected, tr]);

  // Carga el formulario seguro de Izipay cuando ya hay un pedido creado.
  useEffect(() => {
    if (!pay) return;
    const currentPay = pay;
    let active = true;

    async function setupIzipay() {
      setFormReady(false);
      setErr("");
      try {
        const base = (() => {
          try {
            return new URL(currentPay.staticUrl).origin;
          } catch {
            return "https://static.micuentaweb.pe";
          }
        })();

        const addCss = (href: string) => {
          if (!document.querySelector(`link[href="${href}"]`)) {
            const link = document.createElement("link");
            link.rel = "stylesheet";
            link.href = href;
            document.head.appendChild(link);
          }
        };
        // Tema "neon" de Izipay: con "classic", el texto de los campos de tarjeta
        // quedaba cortado por abajo dentro de sus iframes (visto en producción).
        addCss(`${base}/static/js/krypton-client/V4.0/ext/neon-reset.min.css`);

        const win = window as unknown as { KR?: Record<string, unknown> };
        if (!win.KR) {
          await new Promise<void>((resolve) => {
            const themeSrc = `${base}/static/js/krypton-client/V4.0/ext/neon.js`;
            if (document.querySelector(`script[src="${themeSrc}"]`)) return resolve();
            const s = document.createElement("script");
            s.src = themeSrc;
            s.onload = () => resolve();
            s.onerror = () => resolve();
            document.head.appendChild(s);
          });

          await new Promise<void>((resolve, reject) => {
            const mainSrc = `${base}/static/js/krypton-client/V4.0/stable/kr-payment-form.min.js`;
            if (document.querySelector(`script[src="${mainSrc}"]`)) return resolve();
            const s = document.createElement("script");
            s.src = mainSrc;
            s.setAttribute("kr-public-key", currentPay.publicKey);
            s.setAttribute("kr-post-url-success", currentPay.returnUrl);
            s.setAttribute("kr-language", IZIPAY_LANG[locale]);
            s.onload = () => resolve();
            s.onerror = () => reject(new Error(tr("No se pudo cargar el formulario de pago.")));
            document.head.appendChild(s);
          });
        }

        if (!active) return;

        type KrApi = {
          setFormToken?: (token: string) => Promise<unknown>;
          setFormConfig?: (cfg: Record<string, unknown>) => Promise<unknown>;
          removeForms?: () => Promise<unknown>;
        };
        const getKr = () => (window as unknown as { KR?: KrApi }).KR;
        const startTime = Date.now();
        while (!getKr()?.setFormToken && !getKr()?.setFormConfig) {
          if (Date.now() - startTime > 12000) throw new Error(tr("Izipay tardó demasiado en responder. Recarga la página."));
          await new Promise((r) => setTimeout(r, 100));
        }

        const kr = getKr() as KrApi;
        if (typeof kr.removeForms === "function") {
          try {
            await kr.removeForms();
          } catch {
            /* ignorar */
          }
        }
        if (typeof kr.setFormToken === "function") {
          await kr.setFormToken(currentPay.formToken);
        } else if (typeof kr.setFormConfig === "function") {
          await kr.setFormConfig({ formToken: currentPay.formToken, "kr-post-url-success": currentPay.returnUrl, "kr-language": IZIPAY_LANG[locale] });
        }

        if (active) setFormReady(true);
      } catch (e) {
        if (active) setErr(e instanceof Error ? e.message : String(e));
      }
    }

    void setupIzipay();
    return () => {
      active = false;
    };
    // El idioma se toma al abrir el pago: cambiarlo a mitad no debe reiniciar el formulario de tarjeta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pay]);

  // Ventana de pago: bloquea el scroll del fondo y oculta el aviso de cookies.
  // A propósito NO se cierra con Esc ni con clic afuera: con un pago en curso,
  // cerrarla por accidente cancelaba la compra (reportado por el dueño).
  useEffect(() => {
    if (!pay) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.classList.add("paying");
    return () => {
      document.body.style.overflow = prev;
      document.body.classList.remove("paying");
    };
  }, [pay]);

  function changeCoupon(value: string) {
    setCouponCode(value);
    setCoupon(value.trim() ? { ...IDLE_COUPON, status: "checking" } : IDLE_COUPON);
  }

  function changePackage(i: number) {
    setSelectedIndex(i);
    if (couponCode.trim()) setCoupon({ ...IDLE_COUPON, status: "checking" });
  }

  const allChecked = CREDIT_PURCHASE_CHECKS.every((c) => checks[c.id]);
  const couponBlocks = coupon.status === "checking" || coupon.status === "bad";
  const finalCents = selected ? (coupon.status === "ok" ? coupon.finalCents : selected.priceCents) : 0;
  const buyLeft = daily?.purchases.left ?? Infinity;
  const overDailyCap = !!selected && selected.responses > buyLeft;
  const buyBlocked = settings.purchasesPaused || !!me?.purchasesBlockedReason || !!me?.bannedReason;
  const canPay = !!me && !!selected && allChecked && !busy && !couponBlocks && !serviceFull && !overDailyCap && !buyBlocked;

  const providers = settings.paymentProviders.length ? settings.paymentProviders : (["izipay"] as const);
  const payWith = method && (providers as readonly string[]).includes(method) ? method : providers[0];

  // Tras un rechazo de Mercado Pago no se reintenta enseguida con los mismos
  // datos (su antifraude lo toma como patrón riesgoso): 3 minutos de espera.
  const MP_COOLDOWN_MS = 3 * 60_000;
  const [mpWaitUntil, setMpWaitUntil] = useState(0);
  const [nowTs, setNowTs] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => {
      let until = 0;
      try {
        if (mpParam === "rechazado") localStorage.setItem("fb-mp-cooldown", String(Date.now() + MP_COOLDOWN_MS));
        until = Number(localStorage.getItem("fb-mp-cooldown")) || 0;
      } catch {}
      setMpWaitUntil(until);
      setNowTs(Date.now());
    }, 0);
    const tick = setInterval(() => setNowTs(Date.now()), 15_000);
    return () => {
      clearTimeout(t);
      clearInterval(tick);
    };
  }, [mpParam, MP_COOLDOWN_MS]);
  const mpWaitMin = payWith === "mercadopago" && mpWaitUntil > nowTs ? Math.ceil((mpWaitUntil - nowTs) / 60_000) : 0;

  async function start() {
    if (mpWaitMin > 0) {
      setErr(tr("Espera {n} min antes de volver a intentar con Mercado Pago, o elige otro medio de pago.", { n: mpWaitMin }));
      return;
    }
    if (!selected) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/web/credits/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packageIndex: selectedIndex,
          responses: selected.responses,
          couponCode: coupon.status === "ok" ? couponCode.trim() : undefined,
          returnTo,
          checks: Object.keys(checks).filter((k) => checks[k]),
          provider: payWith,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && typeof d.redirectUrl === "string" && /^https:\/\/[a-z0-9.-]*mercadopago\.com(\.[a-z]{2})?\//i.test(d.redirectUrl)) {
        // Mercado Pago: se paga en su página oficial y vuelve aquí.
        window.location.assign(d.redirectUrl);
        return;
      }
      if (!r.ok || !d.formToken) setErr(String(d.message || d.reason || d.error || tr("No se pudo iniciar el pago.")));
      else setPay(d as Pay);
    } catch {
      setErr(tr("Error de red. Intenta de nuevo."));
    }
    setBusy(false);
  }

  const diyHref = whatsappLink(
    settings.whatsappNumber,
    diyUrl.trim()
      ? tr("Hola, quiero que llenen mi formulario: {url}. Necesito {n} respuestas.", { url: diyUrl.trim(), n: diyCount })
      : tr("Hola, quiero que llenen mi formulario. Necesito {n} respuestas.", { n: diyCount })
  );

  return (
    <div className="buy">
      <PurchaseCelebration orderId={paidOrder} onUse={() => router.push("/")} />
      {/* Script de seguridad de Mercado Pago (huella del dispositivo para su
          antifraude): solo si Mercado Pago está activo en la tienda. */}
      {(providers as readonly string[]).includes("mercadopago") && (
        <Script src="https://www.mercadopago.com/v2/security.js" strategy="afterInteractive" {...{ view: "checkout" }} />
      )}
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

      <div className="sheet">
        <div className="sheet-body">
          {me === null && (
            <SignInCard next={returnTo === "/" ? "/comprar-creditos?volver=1" : "/comprar-creditos"} freeCredits={settings.freeSignupCredits} title={tr("Inicia sesión para comprar")} compact />
          )}
          {me && (
            <p className="fine">
              <Rich
                text={
                  me.freeCredits > 0
                    ? tr("Comprando como <b>{email}</b>. Saldo actual: {n} créditos y {f} respuestas gratis.", { email: me.email, n: me.credits, f: me.freeCredits })
                    : tr("Comprando como <b>{email}</b>. Saldo actual: {n} créditos.", { email: me.email, n: me.credits })
                }
              />
            </p>
          )}

          <>
              <fieldset className="group group-first">
                <legend>{tr("Elige un paquete")}</legend>
                <p className="fine">
                  {tr("Puedes enviar hasta {n} respuestas cada 24 horas por cuenta. Los créditos no vencen: un paquete grande se usa en varios días.", {
                    n: capacity?.perUserDaily ?? 500,
                  })}
                  {capacity?.userRemaining !== null && capacity?.userRemaining !== undefined ? tr(" Hoy te quedan {n}.", { n: capacity.userRemaining }) : ""}
                </p>
                {packages.length === 0 && <p className="fine">{tr("Todavía no hay paquetes disponibles. Escríbenos por WhatsApp y te ayudamos.")}</p>}
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
                <p className="fine">{tr("Puedes comprar varios paquetes en el día mientras no pases de {n} créditos.", { n: daily?.purchases.max ?? settings.dailyPurchaseCap })}</p>
                <CreditCalculator
                  packages={packages}
                  balance={me ? me.credits + me.freeCredits : 0}
                  buyLeft={buyLeft}
                  onPick={(i) => {
                    changePackage(i);
                    document.querySelector(".packs")?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }}
                />
                <div className="packs" role="radiogroup" aria-label={tr("Paquetes de créditos")}>
                  {packages.map((p, i) => {
                    const perResponse = p.priceCents / p.responses;
                    const isSel = i === selectedIndex;
                    const tooBig = p.responses > buyLeft;
                    return (
                      <label key={`${p.responses}-${p.priceCents}`} className={`pk${isSel ? " is-sel" : ""}${tooBig ? " is-off" : ""}`}>
                        <input type="radio" name="pkg" checked={isSel} disabled={tooBig} onChange={() => changePackage(i)} />
                        <span className="pk-main">
                          <span className="pk-qty">{tr("{n} respuestas", { n: p.responses })}</span>
                          <span className="pk-rate">
                            {tr("{p} por respuesta", { p: fmtPen(perResponse) })}
                            {p.responses > (capacity?.perUserDaily ?? 500)
                              ? tr(". Se usa en {n} días como mínimo", { n: Math.ceil(p.responses / (capacity?.perUserDaily ?? 500)) })
                              : ""}
                          </span>
                        </span>
                        <span className="pk-side">
                          {tooBig && <span className="pk-tag pk-tag-off">{tr("Supera tu tope de hoy")}</span>}
                          {i === bestIndex && !tooBig && <span className="pk-tag">{tr("Mejor precio")}</span>}
                          <span className="pk-price">{fmtPen(p.priceCents)}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

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
                  <li>{tr("Los créditos no vencen. Si un envío no llega a tu formulario, te devolvemos los créditos de lo que no llegó.")}</li>
                </ul>
              </div>

              {selected && Object.keys(fx).length > 0 && (
                <details className="fx">
                  <summary>{tr("Precio en tu moneda (referencia)")}</summary>
                  <p className="fine">
                    <Rich text={tr("Se cobra en <b>soles peruanos (PEN)</b>: {amount}. Tu banco convierte al tipo de cambio del día; estos montos son aproximados.", { amount: fmtPen(selected.priceCents) })} />
                  </p>
                  <table>
                    <tbody>
                      {Object.entries(fx).map(([cur, rate]) => (
                        <tr key={cur}>
                          <td>{cur}</td>
                          <td>≈ {((selected.priceCents / 100) * rate).toLocaleString(locale, { maximumFractionDigits: cur === "CLP" || cur === "COP" || cur === "ARS" ? 0 : 2 })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}

              <fieldset className="group">
                <legend>{tr("Cupón")}</legend>
                <label className="sr" htmlFor="buy-coupon">
                  {tr("Código de cupón")}
                </label>
                <input
                  id="buy-coupon"
                  type="text"
                  autoComplete="off"
                  maxLength={40}
                  placeholder={tr("Si tienes un código, escríbelo aquí")}
                  value={couponCode}
                  onChange={(e) => changeCoupon(e.target.value)}
                  aria-describedby="coupon-status"
                />
                <p id="coupon-status" className={coupon.status === "bad" ? "msg msg-err" : coupon.status === "ok" ? "msg msg-ok" : "msg"} aria-live="polite">
                  {coupon.status === "checking" && tr("Revisando el cupón…")}
                  {coupon.status === "ok" &&
                    selected &&
                    tr("{p}% de descuento: pagas {final} en vez de {orig}.", { p: coupon.discountPercent, final: fmtPen(coupon.finalCents), orig: fmtPen(selected.priceCents) })}
                  {coupon.status === "bad" && tr(coupon.reason)}
                </p>
                {coupon.status === "ok" && /^VUELVE-/i.test(couponCode.trim()) && (
                  <p className="fine">
                    {tr("Cupón personal: un solo uso, solo para tu cuenta e intransferible; no se acumula ni se canjea por dinero.")}{" "}
                    <a href={legalHref(locale, "terms", "#cupones")} target="_blank" rel="noopener">
                      {tr("Condiciones")}
                    </a>
                  </p>
                )}
              </fieldset>

              <fieldset className="group">
                <legend>{tr("Condiciones")}</legend>
                <div className="checks">
                  {CREDIT_PURCHASE_CHECKS.map((c) => (
                    <div className="check" key={c.id}>
                      <input
                        id={`chk-${c.id}`}
                        type="checkbox"
                        checked={!!checks[c.id]}
                        onChange={(e) => setChecks((prev) => ({ ...prev, [c.id]: e.target.checked }))}
                      />
                      <label htmlFor={`chk-${c.id}`}>{tr(c.text)}</label>
                    </div>
                  ))}
                </div>
              </fieldset>

              {providers.length > 1 && (
                <fieldset className="paymethods">
                  <legend>{t("store.method")}</legend>
                  <label className={`paymethod${payWith === "mercadopago" ? " on" : ""}`}>
                    <input type="radio" name="paymethod" checked={payWith === "mercadopago"} onChange={() => setMethod("mercadopago")} />
                    <span className="paymethod-txt">
                      <b>Mercado Pago</b>
                      <small>{t("store.mpDesc")}</small>
                    </span>
                    <PayLogos brands={MP_BRANDS} />
                  </label>
                  <label className={`paymethod${payWith === "izipay" ? " on" : ""}`}>
                    <input type="radio" name="paymethod" checked={payWith === "izipay"} onChange={() => setMethod("izipay")} />
                    <span className="paymethod-txt">
                      <b>{t("store.card")}</b>
                      <small>{t("store.cardDesc")}</small>
                    </span>
                    <PayLogos brands={IZIPAY_BRANDS} />
                  </label>
                </fieldset>
              )}
              {mpParam === "pendiente" && (
                <div className="note note-warn" role="status">
                  <p>{tr("Tu pago con Mercado Pago está pendiente (por ejemplo PagoEfectivo). Apenas se confirme sumamos tus créditos y te avisamos por correo.")}</p>
                </div>
              )}
              {mpParam === "rechazado" && (
                <div className="note note-err" role="alert">
                  <p>
                    <strong>{tr("Mercado Pago rechazó el pago. No se te cobró nada.")}</strong>{" "}
                    {tr(MP_REJECT_REASONS[mpReason] ?? "Prueba con otra tarjeta u otro medio de pago dentro de Mercado Pago.")}
                  </p>
                  {mpReason && <p className="fine">{tr("Código: {c}", { c: mpReason })}</p>}
                </div>
              )}
              {mpParam === "cancelado" && (
                <div className="note note-warn" role="status">
                  <p>{tr("No se completó el pago. No se te cobró nada; puedes intentarlo de nuevo.")}</p>
                </div>
              )}
              {settings.purchasesPaused && (
                <div className="note note-warn" role="status">
                  <p>{settings.purchasesPauseMessage || tr("Las compras están en pausa por mantenimiento. Vuelve en un rato; tus créditos están seguros.")}</p>
                </div>
              )}
              {me?.purchasesBlockedReason && (
                <div className="note note-err" role="status">
                  <p>{me.purchasesBlockedReason}</p>
                </div>
              )}
              {overDailyCap && (
                <div className="note note-warn" role="status">
                  <p>
                    {buyLeft > 0
                      ? tr("Hoy puedes comprar hasta {n} créditos más. Elige un paquete más chico o vuelve mañana.", { n: buyLeft })
                      : tr("Ya compraste el máximo de créditos de hoy. Puedes comprar más mañana.")}
                  </p>
                </div>
              )}
              {err && (
                <div className="note note-err" role="alert">
                  <p>{tr(err)}</p>
                </div>
              )}
              <button className="b b-primary b-block" type="button" onClick={start} disabled={!canPay}>
                {busy
                  ? t("store.preparing")
                  : serviceFull
                    ? t("store.paused")
                    : !me
                    ? t("store.loginToPay")
                    : selected
                      ? payWith === "mercadopago"
                        ? t("store.payMp", { amount: fmtPen(finalCents) })
                        : t("store.payCard", { amount: fmtPen(finalCents) })
                      : t("store.choose")}
              </button>
              <SecurePayStrip providers={providers} />
              <p className="fine">
                {payWith === "mercadopago"
                  ? settings.mpRequiresLogin
                    ? tr("Pagas en la página oficial de Mercado Pago con tu cuenta de Mercado Pago (inicia sesión para pagar) y vuelves aquí. No vemos ni guardamos los datos de tu tarjeta.")
                    : tr("Pagas en la página oficial de Mercado Pago y vuelves aquí. No vemos ni guardamos los datos de tu tarjeta.")
                  : tr("Pago procesado por Izipay. No guardamos los datos de tu tarjeta.")}
              </p>
          </>

          {pay && (
            <div className="paymodal" role="dialog" aria-modal="true" aria-labelledby="paymodal-h">
              <div className="paymodal-backdrop" />
              <div className="paymodal-card">
                <header className="paymodal-head">
                  <h2 id="paymodal-h">{tr("Completa tu pago")}</h2>
                  <p className="paymodal-kicker">{tr("{n} créditos para FormsBot", { n: pay.credits ?? selected?.responses ?? "" })}</p>
                </header>

                <dl className="paymodal-sum">
                  <div>
                    <dt>{tr("Total a pagar")}</dt>
                    <dd>{fmtPen(pay.amountCents ?? finalCents)}</dd>
                  </div>
                  {pay.originalCents !== undefined && pay.amountCents !== undefined && pay.originalCents > pay.amountCents && (
                    <div>
                      <dt>{tr("Descuento")}</dt>
                      <dd>−{fmtPen(pay.originalCents - pay.amountCents)}</dd>
                    </div>
                  )}
                  <div>
                    <dt>{tr("Pedido")}</dt>
                    <dd className="mono">{pay.orderId}</dd>
                  </div>
                </dl>

                {!formReady && !err && (
                  <div className="paymodal-loading" role="status">
                    <span className="spin" aria-hidden="true" />
                    {tr("Cargando el formulario seguro de Izipay…")}
                  </div>
                )}
                {err && (
                  <div className="note note-err" role="alert">
                    <p>{tr(err)}</p>
                  </div>
                )}
                <div className="kr-wrap">
                  {/* kr-card-form-expanded: el formulario de tarjeta va DENTRO de esta
                      ventana. Sin él, Izipay abría su propia ventanita encima. */}
                  <div className="kr-smart-form" kr-card-form-expanded="" />
                </div>

                <p className="paymodal-trust">
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                    <path fill="currentColor" d="M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5Zm-3 8V6a3 3 0 0 1 6 0v3H9Z" />
                  </svg>
                  {returnTo === "/"
                    ? tr("Tus datos de tarjeta van directo a Izipay. FormsBot nunca los ve ni los guarda. Al terminar vuelves a tu formulario con los créditos cargados.")
                    : tr("Tus datos de tarjeta van directo a Izipay. FormsBot nunca los ve ni los guarda. Al terminar vuelves aquí con los créditos cargados.")}
                </p>
                <button type="button" className="b b-ghost b-block" onClick={() => setPay(null)}>
                  {tr("Cancelar pago")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="alt-ways">
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
              {tr("Enviar por WhatsApp al {phone}", { phone: formatPhone(settings.whatsappNumber) })}
            </a>
            <p className="fine">{tr("Tu formulario debe abrirse sin iniciar sesión y no recolectar correos verificados.")}</p>
          </div>
        </section>

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
      </div>
    </div>
  );
}
