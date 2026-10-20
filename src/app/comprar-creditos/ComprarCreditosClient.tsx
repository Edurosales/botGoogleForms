"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CREDIT_PURCHASE_CHECKS } from "@/lib/webLegal";

type Pkg = { responses: number; priceCents: number };
type Pay = { orderId: string; formToken: string; publicKey: string; staticUrl: string; returnUrl: string };

const fmtPen = (c: number) => `S/ ${(c / 100).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function ComprarCreditosClient({ packages }: { packages: Pkg[] }) {
  const searchParams = useSearchParams();
  const [user, setUser] = useState<{ email: string; name: string; credits: number } | null | undefined>(undefined);
  const [selected, setSelected] = useState<Pkg | null>(packages[1] ?? packages[0] ?? null);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [pay, setPay] = useState<Pay | null>(null);
  const [formReady, setFormReady] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setUser(d.user ?? null))
      .catch(() => setUser(null));
  }, []);

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
            s.onerror = () => reject(new Error("No se pudo cargar la librería de pagos."));
            document.head.appendChild(s);
          });
        }

        if (!active) return;

        const startTime = Date.now();
        while (
          !(window as unknown as { KR?: { setFormToken?: unknown; setFormConfig?: unknown } }).KR?.setFormToken &&
          !(window as unknown as { KR?: { setFormToken?: unknown; setFormConfig?: unknown } }).KR?.setFormConfig
        ) {
          if (Date.now() - startTime > 12000) throw new Error("Tiempo de espera agotado al conectar con Izipay.");
          await new Promise((r) => setTimeout(r, 100));
        }

        const kr = (
          window as unknown as {
            KR: {
              setFormToken?: (token: string) => Promise<unknown>;
              setFormConfig?: (cfg: Record<string, unknown>) => Promise<unknown>;
              removeForms?: () => Promise<unknown>;
            };
          }
        ).KR;

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

    setupIzipay();
    return () => {
      active = false;
    };
  }, [pay]);

  const allChecked = CREDIT_PURCHASE_CHECKS.every((c) => checks[c.id]);
  const canPay = !!user && !!selected && allChecked && !busy;

  async function start() {
    if (!selected) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/web/credits/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responses: selected.responses, checks: Object.keys(checks).filter((k) => checks[k]) }),
      });
      const d = await r.json();
      if (!r.ok) setErr(d.message || "No se pudo iniciar el pago.");
      else setPay(d);
    } catch {
      setErr("Error de red. Intenta de nuevo.");
    }
    setBusy(false);
  }

  const paidOrder = searchParams.get("pagado");
  const errorParam = searchParams.get("error");

  return (
    <div className="tool-card">
      {paidOrder && <p className="tool-ok">✅ Pago confirmado (pedido {paidOrder}) — tus créditos ya están en tu cuenta.</p>}
      {errorParam && <p className="tool-error">No se pudo confirmar el pago ({errorParam}). Si se te descontó, escríbenos.</p>}

      <p>
        {user === undefined && "Comprobando sesión…"}
        {user === null && (
          <a className="btn wa" href="/api/auth/google?next=/comprar-creditos">
            Iniciar sesión con Google para comprar
          </a>
        )}
        {user && (
          <>
            Comprando como <b>{user.email}</b> — saldo actual: <b>{user.credits} créditos</b>.
          </>
        )}
      </p>

      {!pay && (
        <>
          <h3>Elige un paquete</h3>
          <div className="tool-questions">
            {packages.length === 0 && <p className="muted">Aún no hay paquetes configurados — vuelve más tarde.</p>}
            {packages.map((p) => (
              <label key={p.responses} className="tool-check" style={{ cursor: "pointer" }}>
                <input
                  type="radio"
                  name="pkg"
                  checked={selected?.responses === p.responses}
                  onChange={() => setSelected(p)}
                />
                <b>{p.responses} respuestas</b> — {fmtPen(p.priceCents)}
              </label>
            ))}
          </div>

          <h3 style={{ marginTop: 16 }}>Condiciones</h3>
          {CREDIT_PURCHASE_CHECKS.map((c) => (
            <label key={c.id} className="tool-check">
              <input type="checkbox" checked={!!checks[c.id]} onChange={(e) => setChecks((prev) => ({ ...prev, [c.id]: e.target.checked }))} />
              {c.text}
            </label>
          ))}

          {err && <p className="tool-error">{err}</p>}
          <button className="btn wa" onClick={start} disabled={!canPay}>
            {busy ? "Preparando pago…" : selected ? `Pagar ${fmtPen(selected.priceCents)} con tarjeta` : "Elige un paquete"}
          </button>
        </>
      )}

      {pay && (
        <div>
          <h3>Pago seguro con tarjeta</h3>
          <p className="tool-hint">
            Pedido <b>{pay.orderId}</b> · Procesado por Izipay. No almacenamos los datos de tu tarjeta.
          </p>
          {!formReady && !err && <p className="tool-hint">⏳ Cargando campos seguros de Izipay…</p>}
          {err && <p className="tool-error">{err}</p>}
          <div style={{ minHeight: 180, marginTop: 12 }}>
            <div className="kr-smart-form" kr-popin="false" />
          </div>
        </div>
      )}
    </div>
  );
}
