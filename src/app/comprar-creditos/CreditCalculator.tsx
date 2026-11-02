"use client";

import { useMemo, useState } from "react";
import { cheapestPlan, MAX_PLAN_CREDITS, type Pack } from "@/lib/packPlan";
import { fmtPen } from "../clientData";
import { Rich, useLang } from "../LangProvider";

/**
 * Calculadora: cuántas respuestas necesitas → qué paquetes comprar (los del
 * panel, con sus precios), descontando el saldo que ya tienes.
 */
export default function CreditCalculator({
  packages,
  balance,
  buyLeft,
  onPick,
}: {
  packages: Pack[];
  /** Créditos + respuestas gratis que ya tiene (0 sin sesión). */
  balance: number;
  /** Créditos que aún puede comprar hoy (Infinity si no se sabe). */
  buyLeft: number;
  onPick: (index: number) => void;
}) {
  const { tr } = useLang();
  const [wanted, setWanted] = useState(100);
  const need = Math.max(0, Math.min(MAX_PLAN_CREDITS, wanted) - balance);
  const plan = useMemo(() => cheapestPlan(packages, need), [packages, need]);

  if (!packages.length) return null;
  const extra = plan ? plan.credits - need : 0;
  const overToday = !!plan && Number.isFinite(buyLeft) && plan.credits > buyLeft;

  return (
    <div className="calc">
      <div className="calc-head">
        <p className="calc-title">{tr("Calculadora")}</p>
        <label className="calc-input">
          <span>{tr("¿Cuántas respuestas necesitas?")}</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_PLAN_CREDITS}
            value={wanted || ""}
            onChange={(e) => setWanted(Math.max(0, Math.min(MAX_PLAN_CREDITS, Math.floor(Number(e.target.value) || 0))))}
          />
        </label>
      </div>

      {balance > 0 && wanted > 0 && (
        <p className="fine">{tr("Ya tienes {n} en tu saldo: se descuentan.", { n: balance })}</p>
      )}

      {wanted > 0 && need === 0 && <p className="calc-ok">{tr("Te alcanza con tu saldo actual: no necesitas comprar.")}</p>}

      {plan && need > 0 && (
        <>
          <ul className="calc-plan">
            {plan.items.map((it) => (
              <li key={it.index}>
                <span>
                  {it.times > 1 ? `${it.times} × ` : ""}
                  {tr("{n} respuestas", { n: packages[it.index].responses })}
                </span>
                <span>{fmtPen(packages[it.index].priceCents * it.times)}</span>
              </li>
            ))}
          </ul>
          <div className="calc-total">
            <span>
              <Rich
                text={tr("Total: <b>{amount}</b> por {n} créditos ({p} por respuesta).", {
                  amount: fmtPen(plan.priceCents),
                  n: plan.credits,
                  p: fmtPen(plan.priceCents / plan.credits),
                })}
              />
              {extra > 0 ? ` ${tr("Te sobran {n} para otro formulario.", { n: extra })}` : ""}
            </span>
            <button type="button" className="b b-small b-primary" onClick={() => onPick(plan.items[0].index)}>
              {plan.purchases > 1 ? tr("Empezar con el de {n}", { n: packages[plan.items[0].index].responses }) : tr("Elegir este paquete")}
            </button>
          </div>
          {plan.purchases > 1 && <p className="fine">{tr("Cada paquete se paga por separado: compra uno y luego el siguiente.")}</p>}
          {overToday && <p className="fine">{tr("Hoy puedes comprar hasta {n} créditos: el resto, mañana.", { n: buyLeft })}</p>}
        </>
      )}
    </div>
  );
}
