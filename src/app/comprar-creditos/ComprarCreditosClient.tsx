"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { CREDIT_PURCHASE_CHECKS } from "@/lib/webLegal";
import { announceBalanceChange, fmtPen, formatPhone, useMe, usePublicSettings, whatsappLink } from "../clientData";
import { SignInCard } from "../SignIn";

type Pkg = { responses: number; priceCents: number };
type Pay = { orderId: string; formToken: string; publicKey: string; staticUrl: string; returnUrl: string };
type CouponState = { status: "idle" | "checking" | "ok" | "bad"; discountPercent: number; finalCents: number; reason: string };

const IDLE_COUPON: CouponState = { status: "idle", discountPercent: 0, finalCents: 0, reason: "" };

export default function ComprarCreditosClient({ packages: serverPackages }: { packages: Pkg[] }) {
  const searchParams = useSearchParams();
  const { me } = useMe();
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

  const [selectedIndex, setSelectedIndex] = useState(() => (serverPackages.length > 1 ? 1 : 0));
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [couponCode, setCouponCode] = useState("");
  const [coupon, setCoupon] = useState<CouponState>(IDLE_COUPON);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [pay, setPay] = useState<Pay | null>(null);
  const [formReady, setFormReady] = useState(false);

  const [diyUrl, setDiyUrl] = useState("");
  const [diyCount, setDiyCount] = useState(50);

  const returnTo = searchParams.get("volver") ? "/" : "/comprar-creditos";
  const paidOrder = searchParams.get("pagado");
  const errorParam = searchParams.get("error");
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
          setCoupon({ status: "bad", discountPercent: 0, finalCents: 0, reason: String(d.reason || d.message || "Cupón no válido.") });
        }
      } catch {
        setCoupon({ status: "bad", discountPercent: 0, finalCents: 0, reason: "No se pudo validar el cupón." });
      }
    }, 450);
    return () => clearTimeout(t);
  }, [couponCode, selectedIndex, selected]);

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
        addCss(`${base}/static/js/krypton-client/V4.0/ext/classic.css`);

        const win = window as unknown as { KR?: Record<string, unknown> };
        if (!win.KR) {
          await new Promise<void>((resolve) => {
            const themeSrc = `${base}/static/js/krypton-client/V4.0/ext/classic.js`;
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
            s.setAttribute("kr-language", "es-ES");
            s.onload = () => resolve();
            s.onerror = () => reject(new Error("No se pudo cargar el formulario de pago."));
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
          if (Date.now() - startTime > 12000) throw new Error("Izipay tardó demasiado en responder. Recarga la página.");
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
          await kr.setFormConfig({ formToken: currentPay.formToken, "kr-post-url-success": currentPay.returnUrl, "kr-language": "es-ES" });
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
  const canPay = !!me && !!selected && allChecked && !busy && !couponBlocks;

  async function start() {
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
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.formToken) setErr(String(d.message || d.reason || d.error || "No se pudo iniciar el pago."));
      else setPay(d as Pay);
    } catch {
      setErr("Error de red. Intenta de nuevo.");
    }
    setBusy(false);
  }

  const diyHref = whatsappLink(
    settings.whatsappNumber,
    diyUrl.trim()
      ? `Hola, quiero que llenen mi formulario: ${diyUrl.trim()}. Necesito ${diyCount} respuestas.`
      : `Hola, quiero que llenen mi formulario. Necesito ${diyCount} respuestas.`
  );

  return (
    <div className="buy">
      {paidOrder && (
        <div className="note note-ok" role="status">
          <p>
            <strong>Pago confirmado.</strong> El pedido {paidOrder} ya sumó créditos a tu cuenta.
          </p>
        </div>
      )}
      {errorParam && (
        <div className="note note-err" role="alert">
          <p>No se pudo confirmar el pago. Si se te descontó, escríbenos por WhatsApp con la hora del intento y lo revisamos.</p>
        </div>
      )}

      <div className="sheet">
        <div className="sheet-body">
          {me === null && (
            <SignInCard next={returnTo === "/" ? "/comprar-creditos?volver=1" : "/comprar-creditos"} freeCredits={settings.freeSignupCredits} title="Inicia sesión para comprar" compact />
          )}
          {me && (
            <p className="fine">
              Comprando como <strong>{me.email}</strong>. Saldo actual: {me.credits} créditos
              {me.freeCredits > 0 ? ` y ${me.freeCredits} respuestas gratis` : ""}.
            </p>
          )}

          {!pay && (
            <>
              <fieldset className="group group-first">
                <legend>Elige un paquete</legend>
                {packages.length === 0 && <p className="fine">Todavía no hay paquetes disponibles. Escríbenos por WhatsApp y te ayudamos.</p>}
                <div className="packs" role="radiogroup" aria-label="Paquetes de créditos">
                  {packages.map((p, i) => {
                    const perResponse = p.priceCents / p.responses;
                    const isSel = i === selectedIndex;
                    return (
                      <label key={`${p.responses}-${p.priceCents}`} className={isSel ? "pk is-sel" : "pk"}>
                        <input type="radio" name="pkg" checked={isSel} onChange={() => changePackage(i)} />
                        <span className="pk-main">
                          <span className="pk-qty">{p.responses} respuestas</span>
                          <span className="pk-rate">{fmtPen(perResponse)} por respuesta</span>
                        </span>
                        <span className="pk-side">
                          {i === bestIndex && <span className="pk-tag">Mejor precio</span>}
                          <span className="pk-price">{fmtPen(p.priceCents)}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <fieldset className="group">
                <legend>Cupón</legend>
                <label className="sr" htmlFor="buy-coupon">
                  Código de cupón
                </label>
                <input
                  id="buy-coupon"
                  type="text"
                  autoComplete="off"
                  maxLength={40}
                  placeholder="Si tienes un código, escríbelo aquí"
                  value={couponCode}
                  onChange={(e) => changeCoupon(e.target.value)}
                  aria-describedby="coupon-status"
                />
                <p id="coupon-status" className={coupon.status === "bad" ? "msg msg-err" : coupon.status === "ok" ? "msg msg-ok" : "msg"} aria-live="polite">
                  {coupon.status === "checking" && "Revisando el cupón…"}
                  {coupon.status === "ok" &&
                    selected &&
                    `${coupon.discountPercent}% de descuento: pagas ${fmtPen(coupon.finalCents)} en vez de ${fmtPen(selected.priceCents)}.`}
                  {coupon.status === "bad" && coupon.reason}
                </p>
              </fieldset>

              <fieldset className="group">
                <legend>Condiciones</legend>
                <div className="checks">
                  {CREDIT_PURCHASE_CHECKS.map((c) => (
                    <div className="check" key={c.id}>
                      <input
                        id={`chk-${c.id}`}
                        type="checkbox"
                        checked={!!checks[c.id]}
                        onChange={(e) => setChecks((prev) => ({ ...prev, [c.id]: e.target.checked }))}
                      />
                      <label htmlFor={`chk-${c.id}`}>{c.text}</label>
                    </div>
                  ))}
                </div>
              </fieldset>

              {err && (
                <div className="note note-err" role="alert">
                  <p>{err}</p>
                </div>
              )}
              <button className="b b-primary b-block" type="button" onClick={start} disabled={!canPay}>
                {busy
                  ? "Preparando el pago…"
                  : !me
                    ? "Inicia sesión para pagar"
                    : selected
                      ? `Pagar ${fmtPen(finalCents)} con tarjeta`
                      : "Elige un paquete"}
              </button>
              <p className="fine">Pago procesado por Izipay. No guardamos los datos de tu tarjeta.</p>
            </>
          )}

          {pay && (
            <div className="group group-first">
              <h3>Pago con tarjeta</h3>
              <p className="fine">
                Pedido {pay.orderId}. Al terminar vuelves {returnTo === "/" ? "a tu formulario" : "a esta página"} con los créditos ya cargados.
              </p>
              {!formReady && !err && <p className="fine">Cargando el formulario seguro de Izipay…</p>}
              {err && (
                <div className="note note-err" role="alert">
                  <p>{err}</p>
                </div>
              )}
              <div className="kr-wrap">
                <div className="kr-smart-form" kr-popin="false" />
              </div>
              <button type="button" className="b b-text" onClick={() => setPay(null)}>
                Cambiar de paquete
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="alt-ways">
        <section className="sheet" aria-labelledby="diy-h">
          <div className="sheet-body">
            <h2 id="diy-h">Yo lo lleno por ti</h2>
            <p className="sheet-lead">Mándame tu formulario y cuántas respuestas necesitas. Te respondo por WhatsApp con el precio.</p>
            <div className="field">
              <label htmlFor="diy-url">Link de tu formulario</label>
              <input id="diy-url" type="url" maxLength={500} placeholder="https://docs.google.com/forms/…" value={diyUrl} onChange={(e) => setDiyUrl(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="diy-count">Cantidad de respuestas</label>
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
              Enviar por WhatsApp al {formatPhone(settings.whatsappNumber)}
            </a>
            <p className="fine">Tu formulario debe abrirse sin iniciar sesión y no recolectar correos verificados.</p>
          </div>
        </section>

        <section className="sheet" aria-labelledby="soft-h">
          <Image className="sheet-img" src="/soft.png" alt="Ventana del programa FormsBot para escritorio" width={1245} height={847} sizes="(max-width: 900px) 100vw, 480px" />
          <div className="sheet-body">
            <h2 id="soft-h">O compra el programa</h2>
            <p className="sheet-lead">FormsBot para Windows: sin fila, sin límite de respuestas y con tu propia IA. Pago único.</p>
            <a className="b b-ghost b-block" href={settings.buySoftwareUrl} target="_blank" rel="noopener">
              Ver el software
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
