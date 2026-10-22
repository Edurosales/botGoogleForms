"use client";

import { useEffect, useRef, useState } from "react";

type LiveState = {
  status?: string;
  queuePosition?: number;
  paused?: boolean;
  pauseMessage?: string;
  lostTurns?: number;
  promoted?: boolean;
};

/**
 * Fila en vivo (Server-Sent Events): la posición llega sola cada 2 s.
 * - Gratis: mantener esta ventana abierta ES conservar el turno. Si la cierra,
 *   pasa al final de la fila; el navegador pide confirmar antes de cerrar.
 * - Pagados: tienen prioridad y su envío sigue en la nube aunque cierre.
 */
export default function LiveQueue({
  jobId,
  isPaid,
  initialPosition,
  onState,
  onBuy,
}: {
  jobId: string;
  isPaid: boolean;
  initialPosition: number;
  onState: (d: Record<string, unknown>) => void;
  onBuy: () => void;
}) {
  const [live, setLive] = useState<LiveState>({ queuePosition: initialPosition });
  const [connected, setConnected] = useState(false);
  const [lostNotice, setLostNotice] = useState(false);
  const firstLost = useRef<number | null>(null);
  const onStateRef = useRef(onState);
  useEffect(() => {
    onStateRef.current = onState;
  });

  useEffect(() => {
    const es = new EventSource(`/api/web/jobs/${jobId}/live`);
    es.addEventListener("open", () => setConnected(true));
    es.addEventListener("error", () => setConnected(false));
    es.addEventListener("state", (ev) => {
      let d: Record<string, unknown>;
      try {
        d = JSON.parse((ev as MessageEvent).data);
      } catch {
        return;
      }
      const lost = Number(d.lostTurns ?? 0);
      if (firstLost.current === null) firstLost.current = lost;
      else if (lost > firstLost.current) {
        firstLost.current = lost;
        setLostNotice(true);
      }
      setLive({
        status: String(d.status ?? ""),
        queuePosition: Number(d.queuePosition ?? 0),
        paused: d.paused === true,
        pauseMessage: typeof d.pauseMessage === "string" ? d.pauseMessage : "",
        lostTurns: lost,
        promoted: d.promoted === true,
      });
      onStateRef.current(d);
      if (d.status && d.status !== "queued") es.close();
    });
    return () => es.close();
  }, [jobId]);

  // Gratis: confirmar antes de cerrar o recargar (el navegador muestra su propio texto).
  useEffect(() => {
    if (isPaid) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isPaid]);

  const pos = live.queuePosition ?? 0;
  const ahead = Math.max(0, pos - 1);
  const dots = Math.min(ahead, 12);

  return (
    <div className={`lq${isPaid ? " lq-paid" : ""}`} aria-live="polite">
      <div className="lq-head">
        <span className={`lq-live${connected ? " on" : ""}`}>
          <i aria-hidden="true" /> {connected ? "En vivo" : "Reconectando…"}
        </span>
        <span className="lq-kind">{isPaid ? "Fila prioritaria" : "Fila gratuita"}</span>
      </div>

      <div className="lq-ring">
        <p className="lq-label">Tu posición</p>
        <p className="lq-number" key={pos}>
          {pos > 0 ? pos : "…"}
        </p>
        <p className="lq-sub">
          {pos === 1
            ? "¡Eres el siguiente!"
            : pos > 1
              ? `${ahead} ${ahead === 1 ? "envío" : "envíos"} antes que el tuyo`
              : "Calculando tu lugar…"}
        </p>
      </div>

      {dots > 0 && (
        <div className="lq-line" aria-hidden="true">
          {Array.from({ length: dots }, (_, i) => (
            <span key={i} style={{ animationDelay: `${i * 90}ms` }} />
          ))}
          {ahead > dots && <em>+{ahead - dots}</em>}
          <b>Tú</b>
        </div>
      )}

      {live.promoted && <div className="note note-ok"><p>Te subimos de puesto en la fila.</p></div>}

      {live.paused && (
        <div className="note note-warn">
          <p>
            <strong>{isPaid ? "Servicio en pausa." : "La fila gratuita está en pausa."}</strong>{" "}
            {live.pauseMessage ||
              (isPaid
                ? "Retomamos en breve; tu envío no pierde su lugar."
                : "Ahora atendemos primero a los envíos prioritarios. Conservas tu lugar mientras sigas en esta ventana.")}
          </p>
        </div>
      )}

      {lostNotice && (
        <div className="note note-err">
          <p>
            Saliste de la ventana y perdiste tu turno: volviste al final de la fila. Mantén esta pestaña abierta para no perderlo.
          </p>
        </div>
      )}

      {isPaid ? (
        <p className="fine center">Tienes prioridad: puedes cerrar esta pestaña, tu envío sigue en la nube y te avisamos por correo.</p>
      ) : (
        <div className="lq-warn">
          <p>
            <strong>No salgas de esta ventana o perderás tu turno.</strong> Si la cierras, tu envío pasa al final de la fila; si no
            vuelves en 10 minutos, se cancela (te devolvemos tus respuestas gratis).
          </p>
          <button type="button" className="b b-small b-primary" onClick={onBuy}>
            Saltar la fila con créditos
          </button>
        </div>
      )}
    </div>
  );
}
