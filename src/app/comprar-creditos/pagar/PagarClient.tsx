"use client";

/**
 * Página de pago (checkout) — antes era una ventana emergente encima de la
 * tienda. Como en las tiendas grandes: a la izquierda los pasos (cuenta,
 * medio de pago, cupón, condiciones, tarjeta) y a la derecha el resumen fijo
 * del pedido con el ahorro, el precio en tu moneda y las garantías.
 * Mercado Pago sigue llevando a su página oficial; Izipay muestra su
 * formulario de tarjeta aquí mismo, dentro de la página.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Script from "next/script";
import { useSearchParams } from "next/navigation";
import { legalHref, type Locale } from "@/lib/i18n";
import { CREDIT_PURCHASE_CHECKS } from "@/lib/webLegal";
import { fmtPen, useDailyLimits, useMe, usePublicSettings } from "../../clientData";
import { SignInCard } from "../../SignIn";
import { Rich, useLang } from "../../LangProvider";
import { DLOCAL_BRANDS, IZIPAY_BRANDS, MP_BRANDS, PayLogos, SecurePayStrip } from "../PayLogos";
import { MP_REJECT_REASONS } from "../mpReasons";
import Flag from "../Flag";
import { packSavings } from "../savings";

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
type Capacity = { globalRemaining: number; perUserDaily: number; testPayments: boolean };

/** Rechazo de Izipay: qué hacer (en vez de reintentar con la misma tarjeta). */
const IZI_REFUSED_MSG =
  "Tu banco rechazó el pago. No se te cobró nada. Lo más común: la tarjeta no tiene activadas las compras por internet (actívalas en la app de tu banco), no tiene saldo o es una tarjeta de débito sin pagos en línea. Prueba otra tarjeta u otro medio de pago.";

const IDLE_COUPON: CouponState = { status: "idle", discountPercent: 0, finalCents: 0, reason: "" };

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path fill="currentColor" d="M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5Zm-3 8V6a3 3 0 0 1 6 0v3H9Z" />
    </svg>
  );
}

export default function PagarClient({ packages: serverPackages }: { packages: Pkg[] }) {
  const { t, tr, locale } = useLang();
  const searchParams = useSearchParams();
  const { me } = useMe();
  const { limits: daily } = useDailyLimits(Boolean(me));
  const settings = usePublicSettings();

  const packages = useMemo(
    () => (serverPackages.length ? serverPackages : settings.creditPackages).filter((p) => p.responses > 0 && p.priceCents > 0),
    [serverPackages, settings.creditPackages]
  );
  const wanted = Number(searchParams.get("paquete"));
  const selectedIndex = Number.isInteger(wanted) && wanted >= 0 && wanted < packages.length ? wanted : packages.length > 1 ? 1 : 0;
  const selected = packages[selectedIndex] ?? null;
  const savings = selected ? packSavings(packages, selected) : null;

  const volver = !!searchParams.get("volver");
  const returnTo = volver ? "/" : "/comprar-creditos";
  const storeHref = `/comprar-creditos${volver ? "?volver=1" : ""}`;
  const selfHref = `/comprar-creditos/pagar?paquete=${selectedIndex}${volver ? "&volver=1" : ""}`;
  const errorParam = searchParams.get("error");
  const mpParam = searchParams.get("mp");
  const dlParam = searchParams.get("dl");
  const mpReason = searchParams.get("motivo") || "";

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

  const [capacity, setCapacity] = useState<Capacity | null>(null);
  useEffect(() => {
    fetch("/api/web/capacity", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => d?.ok && setCapacity(d as Capacity))
      .catch(() => {});
  }, []);
  const serviceFull = !!capacity && capacity.globalRemaining <= 0;

  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [couponCode, setCouponCode] = useState(() => (searchParams.get("cupon") ?? "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 40));
  const [couponOpen, setCouponOpen] = useState(() => !!searchParams.get("cupon"));
  const [coupon, setCoupon] = useState<CouponState>(IDLE_COUPON);
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState<"izipay" | "mercadopago" | "dlocalgo" | "">("");
  const [err, setErr] = useState("");
  const [pay, setPay] = useState<Pay | null>(null);
  const [formReady, setFormReady] = useState(false);

  // Validación del cupón en vivo (con pausa para no consultar en cada tecla).
  useEffect(() => {
    const code = couponCode.trim();
    if (!code || !selected) return;
    const tm = setTimeout(async () => {
      try {
        const qs = new URLSearchParams({ code, packageIndex: String(selectedIndex) });
        const r = await fetch(`/api/web/coupons/validate?${qs}`, { cache: "no-store" });
        const d = await r.json().catch(() => ({}));
        if (d.ok) {
          setCoupon({ status: "ok", discountPercent: Number(d.discountPercent) || 0, finalCents: Number(d.finalCents) || selected.priceCents, reason: "" });
        } else {
          setCoupon({ status: "bad", discountPercent: 0, finalCents: 0, reason: String(d.reason || d.message || tr("Cupón no válido.")) });
        }
      } catch {
        setCoupon({ status: "bad", discountPercent: 0, finalCents: 0, reason: tr("No se pudo validar el cupón.") });
      }
    }, 450);
    return () => clearTimeout(tm);
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

        type KrError = { errorCode?: string; errorMessage?: string; detailedErrorCode?: string; detailedErrorMessage?: string };
        type KrApi = {
          setFormToken?: (token: string) => Promise<unknown>;
          setFormConfig?: (cfg: Record<string, unknown>) => Promise<unknown>;
          removeForms?: () => Promise<unknown>;
          onError?: (cb: (e: KrError) => void) => unknown;
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

        // Rechazo del banco o del antifraude: explicar qué hacer en vez de dejar
        // que reintente con la misma tarjeta (se acumulaban intentos rechazados).
        // Los errores de escritura de la tarjeta (CLIENT_…) los muestra el propio formulario.
        if (typeof kr.onError === "function") {
          kr.onError((e) => {
            const code = String(e?.errorCode || "");
            if (!active || !code || code.startsWith("CLIENT_")) return;
            const detail = [e.detailedErrorCode, e.detailedErrorMessage || e.errorMessage].filter(Boolean).join(" ").slice(0, 120);
            setErr(
              tr(IZI_REFUSED_MSG) + (detail ? ` ${tr("Motivo: {m}", { m: detail })}` : "")
            );
          });
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

  function changeCoupon(value: string) {
    setCouponCode(value);
    setCoupon(value.trim() ? { ...IDLE_COUPON, status: "checking" } : IDLE_COUPON);
  }

  const allChecked = CREDIT_PURCHASE_CHECKS.every((c) => checks[c.id]);
  const couponBlocks = coupon.status === "checking" || coupon.status === "bad";
  const finalCents = selected ? (coupon.status === "ok" ? coupon.finalCents : selected.priceCents) : 0;
  const buyLeft = daily?.purchases.left ?? Infinity;
  const overDailyCap = !!selected && selected.responses > buyLeft;
  const buyBlocked = settings.purchasesPaused || !!me?.purchasesBlockedReason || !!me?.bannedReason;
  const canPay = !!me && !!selected && allChecked && !busy && !couponBlocks && !serviceFull && !overDailyCap && !buyBlocked && !pay;

  const providers = settings.paymentProviders.length ? settings.paymentProviders : (["izipay"] as const);
  const payWith = method && (providers as readonly string[]).includes(method) ? method : providers[0];

  // Tras un rechazo de Mercado Pago no se reintenta enseguida con los mismos
  // datos (su antifraude lo toma como patrón riesgoso): 3 minutos de espera.
  const MP_COOLDOWN_MS = 3 * 60_000;
  const [mpWaitUntil, setMpWaitUntil] = useState(0);
  const [nowTs, setNowTs] = useState(0);
  useEffect(() => {
    const tm = setTimeout(() => {
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
      clearTimeout(tm);
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
      if (
        r.ok &&
        typeof d.redirectUrl === "string" &&
        (/^https:\/\/[a-z0-9.-]*mercadopago\.com(\.[a-z]{2})?\//i.test(d.redirectUrl) || /^https:\/\/([a-z0-9-]+\.)*dlocalgo\.com\//i.test(d.redirectUrl))
      ) {
        // dLocal Go / Mercado Pago: se paga en su página segura y vuelve aquí.
        window.location.assign(d.redirectUrl);
        return;
      }
      if (!r.ok || !d.formToken) setErr(String(d.message || d.reason || d.error || tr("No se pudo iniciar el pago.")));
      else {
        setPay(d as Pay);
        // La tarjeta aparece en la misma página: se lleva la vista hasta ella.
        setTimeout(() => document.getElementById("card-step")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
      }
    } catch {
      setErr(tr("Error de red. Intenta de nuevo."));
    }
    setBusy(false);
  }

  if (!selected) {
    return (
      <div className="co-empty sheet">
        <div className="sheet-body">
          <p>{tr("Todavía no hay paquetes disponibles. Escríbenos por WhatsApp y te ayudamos.")}</p>
          <Link className="b b-ghost" href={storeHref}>
            {tr("Volver a los paquetes")}
          </Link>
        </div>
      </div>
    );
  }

  const perResponse = finalCents / selected.responses;
  const step = (n: number) => <span className="co-step-n">{n}</span>;
  let stepN = 0;

  return (
    <div className="co">
      {(providers as readonly string[]).includes("mercadopago") && (
        <Script src="https://www.mercadopago.com/v2/security.js" strategy="afterInteractive" {...{ view: "checkout" }} />
      )}

      <nav className="co-crumbs" aria-label={tr("Pasos de la compra")}>
        <Link href={storeHref}>{tr("1. Paquete")}</Link>
        <span aria-hidden="true">›</span>
        <b aria-current="step">{tr("2. Pago")}</b>
        <span aria-hidden="true">›</span>
        <span>{tr("3. Listo")}</span>
      </nav>

      <div className="co-head">
        <h1>{tr("Finalizar compra")}</h1>
        <p className="co-secure">
          <LockIcon /> {tr("Pago seguro. FormsBot nunca ve ni guarda los datos de tu tarjeta.")}
        </p>
      </div>

      {capacity?.testPayments && (
        <div className="note note-warn" role="status">
          <p>
            <Rich text={tr("<b>Pagos en modo prueba.</b> Esta tienda usa credenciales de prueba de Izipay: ningún pago es real y no se entregan créditos.")} />
          </p>
        </div>
      )}
      {errorParam && (
        <div className="note note-err" role="alert">
          <p>{tr("No se pudo confirmar el pago. Si se te descontó, escríbenos por WhatsApp con la hora del intento y lo revisamos.")}</p>
        </div>
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
      {dlParam === "pendiente" && (
        <div className="note note-warn" role="status">
          <p>{tr("Tu pago está en revisión. Apenas se confirme sumamos tus créditos y te avisamos por correo.")}</p>
        </div>
      )}
      {dlParam === "rechazado" && (
        <div className="note note-err" role="alert">
          <p>
            <strong>{tr("El pago fue rechazado. No se te cobró nada.")}</strong>{" "}
            {tr("Prueba con otra tarjeta o revisa que tu tarjeta tenga activadas las compras por internet.")}
          </p>
        </div>
      )}
      {dlParam === "cancelado" && (
        <div className="note note-warn" role="status">
          <p>{tr("No se completó el pago. No se te cobró nada; puedes intentarlo de nuevo.")}</p>
        </div>
      )}
      {mpParam === "cancelado" && (
        <div className="note note-warn" role="status">
          <p>{tr("No se completó el pago. No se te cobró nada; puedes intentarlo de nuevo.")}</p>
        </div>
      )}

      <div className="co-grid">
        <div className="co-main">
          {/* Paso: cuenta */}
          <section className="co-card" aria-labelledby="co-acc">
            <h2 id="co-acc">
              {step(++stepN)} {tr("Tu cuenta")}
            </h2>
            {me === undefined && <p className="fine">{tr("Comprobando tu sesión…")}</p>}
            {me === null && <SignInCard next={selfHref} freeCredits={settings.freeSignupCredits} title={tr("Inicia sesión para comprar")} compact />}
            {me && (
              <p className="co-acc">
                <span className="co-av" aria-hidden="true">
                  {(me.email || "?").charAt(0).toUpperCase()}
                </span>
                <span>
                  <b>{me.email}</b>
                  <span className="fine">
                    {me.freeCredits > 0
                      ? tr("Saldo actual: {n} créditos y {f} respuestas gratis.", { n: me.credits, f: me.freeCredits })
                      : tr("Saldo actual: {n} créditos.", { n: me.credits })}
                  </span>
                </span>
              </p>
            )}
          </section>

          {/* Paso: medio de pago */}
          <section className="co-card" aria-labelledby="co-method">
            <h2 id="co-method">
              {step(++stepN)} {t("store.method")}
            </h2>
            <div className="paymethods co-methods" role="radiogroup" aria-label={t("store.method")}>
              {(providers as readonly string[]).includes("dlocalgo") && (
                <label className={`paymethod${payWith === "dlocalgo" ? " on" : ""}`}>
                  <input type="radio" name="paymethod" checked={payWith === "dlocalgo"} disabled={!!pay} onChange={() => setMethod("dlocalgo")} />
                  <span className="paymethod-txt">
                    <b>{tr("Tarjeta de crédito o débito")}</b>
                    <small>{tr("Visa, Mastercard, Amex, Diners y otros medios (dLocal Go)")}</small>
                  </span>
                  <PayLogos brands={DLOCAL_BRANDS} />
                </label>
              )}
              {(providers as readonly string[]).includes("mercadopago") && (
                <label className={`paymethod${payWith === "mercadopago" ? " on" : ""}`}>
                  <input type="radio" name="paymethod" checked={payWith === "mercadopago"} disabled={!!pay} onChange={() => setMethod("mercadopago")} />
                  <span className="paymethod-txt">
                    <b>Mercado Pago</b>
                    <small>{t("store.mpDesc")}</small>
                  </span>
                  <PayLogos brands={MP_BRANDS} />
                </label>
              )}
              {(providers as readonly string[]).includes("izipay") && (
                <label className={`paymethod${payWith === "izipay" ? " on" : ""}`}>
                  <input type="radio" name="paymethod" checked={payWith === "izipay"} disabled={!!pay} onChange={() => setMethod("izipay")} />
                  <span className="paymethod-txt">
                    <b>{t("store.card")}</b>
                    <small>{t("store.cardDesc")}</small>
                  </span>
                  <PayLogos brands={IZIPAY_BRANDS} />
                </label>
              )}
            </div>
            <p className="fine">
              {payWith === "dlocalgo"
                ? tr("Al pulsar Pagar vas a la página segura de dLocal Go, escribes tu tarjeta y vuelves aquí con los créditos cargados. No vemos ni guardamos los datos de tu tarjeta.")
                : payWith === "mercadopago"
                ? settings.mpRequiresLogin
                  ? tr("Pagas en la página oficial de Mercado Pago con tu cuenta de Mercado Pago (inicia sesión para pagar) y vuelves aquí. No vemos ni guardamos los datos de tu tarjeta.")
                  : tr("Pagas en la página oficial de Mercado Pago y vuelves aquí. No vemos ni guardamos los datos de tu tarjeta.")
                : tr("Escribes tu tarjeta en el formulario seguro de Izipay, aquí mismo. No guardamos los datos de tu tarjeta.")}
            </p>
          </section>

          {/* Paso: cupón (opcional) */}
          <section className="co-card" aria-labelledby="co-coupon">
            <h2 id="co-coupon">
              {step(++stepN)} {tr("Cupón")} <span className="co-opt">{tr("(opcional)")}</span>
            </h2>
            {!couponOpen ? (
              <button type="button" className="linkish" onClick={() => setCouponOpen(true)} disabled={!!pay}>
                {tr("¿Tienes un cupón? Escríbelo aquí")}
              </button>
            ) : (
              <>
                <label className="sr" htmlFor="buy-coupon">
                  {tr("Código de cupón")}
                </label>
                <input
                  id="buy-coupon"
                  type="text"
                  autoComplete="off"
                  maxLength={40}
                  disabled={!!pay}
                  placeholder={tr("Si tienes un código, escríbelo aquí")}
                  value={couponCode}
                  onChange={(e) => changeCoupon(e.target.value)}
                  aria-describedby="coupon-status"
                />
                <p id="coupon-status" className={coupon.status === "bad" ? "msg msg-err" : coupon.status === "ok" ? "msg msg-ok" : "msg"} aria-live="polite">
                  {coupon.status === "checking" && tr("Revisando el cupón…")}
                  {coupon.status === "ok" &&
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
              </>
            )}
          </section>

          {/* Paso: condiciones */}
          <section className="co-card" aria-labelledby="co-terms">
            <h2 id="co-terms">
              {step(++stepN)} {tr("Condiciones")}
            </h2>
            <div className="checks">
              {CREDIT_PURCHASE_CHECKS.map((c) => (
                <div className="check" key={c.id}>
                  <input
                    id={`chk-${c.id}`}
                    type="checkbox"
                    checked={!!checks[c.id]}
                    disabled={!!pay}
                    onChange={(e) => setChecks((prev) => ({ ...prev, [c.id]: e.target.checked }))}
                  />
                  <label htmlFor={`chk-${c.id}`}>{tr(c.text)}</label>
                </div>
              ))}
            </div>
            <p className="fine">
              {tr("Al pagar aceptas los")}{" "}
              <a href={legalHref(locale, "terms")} target="_blank" rel="noopener">
                {tr("Términos del servicio")}
              </a>{" "}
              {tr("y la")}{" "}
              <a href={legalHref(locale, "privacy")} target="_blank" rel="noopener">
                {tr("Política de privacidad")}
              </a>
              .
            </p>
          </section>

          {/* Avisos que impiden pagar */}
          {settings.purchasesPaused && (
            <div className="note note-warn" role="status">
              <p>{settings.purchasesPauseMessage || tr("Las compras están en pausa por mantenimiento. Vuelve en un rato; tus créditos están seguros.")}</p>
            </div>
          )}
          {serviceFull && (
            <div className="note note-warn" role="alert">
              <p>{tr("El servicio llegó a su capacidad de hoy. La compra se reabre en unas horas.")}</p>
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

          {!pay && (
            <div className="co-pay">
              <button className="b b-primary b-block co-paybtn" type="button" onClick={start} disabled={!canPay}>
                {busy
                  ? t("store.preparing")
                  : serviceFull
                    ? t("store.paused")
                    : !me
                      ? t("store.loginToPay")
                      : t("store.payCard", { amount: fmtPen(finalCents) })}
              </button>
              {me && !allChecked && <p className="fine co-hint">{tr("Marca las condiciones para continuar.")}</p>}
              <SecurePayStrip providers={providers} />
            </div>
          )}

          {/* Paso: tarjeta (Izipay), dentro de la página */}
          {pay && (
            <section className="co-card co-cardform" id="card-step" aria-labelledby="co-card-h">
              <h2 id="co-card-h">
                {step(++stepN)} {tr("Datos de tu tarjeta")}
              </h2>
              <p className="fine">{tr("Pedido {id}", { id: pay.orderId })}</p>
              {!formReady && !err && (
                <div className="paymodal-loading" role="status">
                  <span className="spin" aria-hidden="true" />
                  {tr("Cargando el formulario seguro de Izipay…")}
                </div>
              )}
              <div className="kr-wrap">
                {/* kr-card-form-expanded: el formulario de tarjeta va DENTRO de la página. */}
                <div className="kr-smart-form" kr-card-form-expanded="" />
              </div>
              <p className="paymodal-trust">
                <LockIcon />
                {returnTo === "/"
                  ? tr("Tus datos de tarjeta van directo a Izipay. FormsBot nunca los ve ni los guarda. Al terminar vuelves a tu formulario con los créditos cargados.")
                  : tr("Tus datos de tarjeta van directo a Izipay. FormsBot nunca los ve ni los guarda. Al terminar vuelves aquí con los créditos cargados.")}
              </p>
              <button
                type="button"
                className="b b-ghost b-block"
                onClick={() => {
                  setPay(null);
                  setErr("");
                }}
              >
                {tr("Cambiar medio de pago")}
              </button>
            </section>
          )}
        </div>

        {/* Resumen fijo del pedido */}
        <aside className="co-side" aria-labelledby="co-sum-h">
          <div className="co-sum">
            <h2 id="co-sum-h">{tr("Resumen del pedido")}</h2>
            <div className="co-pack">
              <span className="co-pack-ic" aria-hidden="true">
                {selected.responses}
              </span>
              <span>
                <b>{tr("{n} créditos", { n: selected.responses })}</b>
                <span className="fine">{tr("{n} respuestas para tu formulario", { n: selected.responses })}</span>
              </span>
              <Link className="co-change" href={storeHref}>
                {tr("Cambiar")}
              </Link>
            </div>
            <dl>
              {savings && (
                <div>
                  <dt>{tr("Precio normal (a {p} c/u)", { p: fmtPen(savings.baseRateCents) })}</dt>
                  <dd className="co-strike">{fmtPen(savings.refCents)}</dd>
                </div>
              )}
              {savings && (
                <div className="co-save">
                  <dt>{tr("Ahorro del paquete")}</dt>
                  <dd>−{fmtPen(savings.refCents - selected.priceCents)}</dd>
                </div>
              )}
              {coupon.status === "ok" && (
                <div className="co-save">
                  <dt>{tr("Cupón ({p}%)", { p: coupon.discountPercent })}</dt>
                  <dd>−{fmtPen(selected.priceCents - finalCents)}</dd>
                </div>
              )}
              <div>
                <dt>{tr("Precio por respuesta")}</dt>
                <dd>{fmtPen(perResponse)}</dd>
              </div>
              <div className="co-total">
                <dt>{tr("Total")}</dt>
                <dd>{fmtPen(finalCents)}</dd>
              </div>
            </dl>
            <p className="fine">{tr("Precios en soles peruanos (PEN). Pago único, sin suscripción.")}</p>

            {Object.keys(fx).length > 0 && (
              <details className="fx">
                <summary>{tr("Precio en tu moneda (referencia)")}</summary>
                <p className="fine">
                  <Rich text={tr("Se cobra en <b>soles peruanos (PEN)</b>: {amount}. Tu banco convierte al tipo de cambio del día; estos montos son aproximados.", { amount: fmtPen(finalCents) })} />
                </p>
                <table>
                  <tbody>
                    {Object.entries(fx).map(([cur, rate]) => (
                      <tr key={cur}>
                        <td>
                          <span className="fx-cur">
                            <Flag code={cur} />
                            {cur}
                          </span>
                        </td>
                        <td>≈ {((finalCents / 100) * rate).toLocaleString(locale, { maximumFractionDigits: cur === "CLP" || cur === "COP" || cur === "ARS" ? 0 : 2 })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}
          </div>

          <ul className="co-guarantees">
            <li>{tr("Créditos al instante y comprobante por correo.")}</li>
            <li>{tr("Los créditos no vencen.")}</li>
            <li>{tr("Si una respuesta no llega, el crédito vuelve solo a tu cuenta.")}</li>
            <li>{tr("Soporte de personas reales por Mensajes y Telegram.")}</li>
          </ul>
        </aside>
      </div>
    </div>
  );
}
