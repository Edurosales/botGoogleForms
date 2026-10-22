"use client";

import { useEffect, useState } from "react";
import { announceBalanceChange, fmtPen } from "./clientData";

type Order = { order_id: string; credits: number; amount_cents: number; status: string };

/**
 * Ventana de "compra confirmada" al volver de Izipay (?pagado=<pedido>).
 * Lee el pedido real del servidor; si el aviso de Izipay aún no llegó,
 * muestra "Confirmando…" y reintenta unos segundos. Se muestra una sola vez
 * por pedido.
 */
export default function PurchaseCelebration({ orderId, onUse }: { orderId: string | null; onUse?: () => void }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [state, setState] = useState<"hidden" | "checking" | "ok" | "pending">("hidden");

  useEffect(() => {
    if (!orderId || !/^WB-\d{8}-[A-F0-9]{6}$/.test(orderId)) return;
    try {
      if (sessionStorage.getItem(`celebrated:${orderId}`)) return;
    } catch {
      /* sin sessionStorage: se muestra igual */
    }
    let active = true;
    let tries = 0;
    const check = async () => {
      tries++;
      try {
        const d = await fetch("/api/web/orders", { cache: "no-store" }).then((r) => r.json());
        const found = (d?.orders as Order[] | undefined)?.find((o) => o.order_id === orderId);
        if (!active) return;
        if (found && found.status === "paid") {
          setOrder(found);
          setState("ok");
          announceBalanceChange();
          return;
        }
      } catch {
        /* reintenta */
      }
      if (!active) return;
      if (tries < 6) {
        setState("checking");
        setTimeout(check, 2000);
      } else {
        setState("pending");
      }
    };
    const t = setTimeout(check, 0);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [orderId]);

  function close() {
    try {
      if (orderId) sessionStorage.setItem(`celebrated:${orderId}`, "1");
    } catch {
      /* ignorar */
    }
    setState("hidden");
  }

  if (state === "hidden") return null;

  return (
    <div className="paymodal" role="dialog" aria-modal="true" aria-labelledby="cele-h">
      <div className="paymodal-backdrop" onClick={state === "ok" ? close : undefined} />
      <div className="paymodal-card cele">
        {state === "checking" && (
          <div className="paymodal-loading" role="status">
            <span className="spin" aria-hidden="true" />
            Confirmando tu pago con Izipay…
          </div>
        )}
        {state === "pending" && (
          <>
            <h2 id="cele-h">Tu pago se está confirmando</h2>
            <p className="sheet-lead">
              Izipay todavía no nos avisó. Los créditos se suman solos apenas llegue la confirmación; te avisaremos en las
              notificaciones.
            </p>
            <button type="button" className="b b-primary b-block" onClick={close}>
              Entendido
            </button>
          </>
        )}
        {state === "ok" && order && (
          <>
            <div className="cele-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="30" height="30">
                <path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z" />
              </svg>
            </div>
            <h2 id="cele-h">¡Compra confirmada!</h2>
            <p className="cele-amount">+{order.credits} créditos</p>
            <p className="sheet-lead">
              Pagaste {fmtPen(order.amount_cents)}. Ya están en tu saldo: úsalos con IA, fila prioritaria y formularios
              grandes.
            </p>
            <p className="fine">Pedido {order.order_id}</p>
            <button
              type="button"
              className="b b-primary b-block"
              onClick={() => {
                close();
                onUse?.();
              }}
            >
              Usar mis créditos
            </button>
          </>
        )}
      </div>
    </div>
  );
}
