"use client";

/**
 * "Compra con confianza": garantías que el servicio cumple de verdad,
 * cifras reales del servicio y comentarios REALES de clientes que el dueño
 * carga en Admin → Configuración. Nunca se muestran comentarios inventados:
 * si no hay ninguno cargado, esa parte no aparece.
 */
import { useLang } from "../LangProvider";
import { usePublicSettings, SUPPORT_TELEGRAM } from "../clientData";

// Desde cuántas respuestas enviadas vale la pena mostrar la cifra.
const MIN_STATS = 1000;

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path fill="currentColor" d={d} />
    </svg>
  );
}

const ICONS = {
  lock: "M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Z",
  bolt: "M13 2 4 14h6l-1 8 9-12h-6l1-8Z",
  back: "M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8Z",
  chat: "M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2Z",
};

function Stars({ n }: { n: number }) {
  return (
    <span className="tst-stars" aria-label={`${n}/5`}>
      {"★★★★★".slice(0, n)}
      <span aria-hidden="true" className="tst-stars-off">
        {"★★★★★".slice(n)}
      </span>
    </span>
  );
}

export default function StoreTrust() {
  const { tr, locale } = useLang();
  const settings = usePublicSettings();
  const stats = settings.stats && settings.stats.responses >= MIN_STATS ? settings.stats : null;
  const fmt = (n: number) => n.toLocaleString(locale);
  const items = [
    { icon: ICONS.lock, title: tr("Pago 100 % seguro"), text: tr("Lo procesa Izipay o Mercado Pago. FormsBot nunca ve ni guarda tu tarjeta.") },
    { icon: ICONS.bolt, title: tr("Créditos al instante"), text: tr("Se cargan apenas se confirma el pago y te llega el comprobante por correo.") },
    { icon: ICONS.back, title: tr("Devolución automática"), text: tr("Si una respuesta no llega a tu formulario, el crédito vuelve solo a tu cuenta. Los créditos no vencen.") },
    { icon: ICONS.chat, title: tr("Soporte de personas reales"), text: tr("Escríbenos por Mensajes o Telegram y te respondemos.") },
  ];

  return (
    <section className="store-trust" aria-labelledby="trust-h">
      <h2 id="trust-h">{tr("Compra con confianza")}</h2>
      {stats && (
        <p className="trust-stats">
          {tr("{r} respuestas de prueba enviadas a {f} formularios.", { r: fmt(stats.responses), f: fmt(stats.forms) })}
        </p>
      )}
      <ul className="trust-grid">
        {items.map((it) => (
          <li key={it.title}>
            <span className="trust-ic">
              <Icon d={it.icon} />
            </span>
            <span>
              <b>{it.title}</b>
              <span>
                {it.text}
                {it.icon === ICONS.chat && (
                  <>
                    {" "}
                    <a href={SUPPORT_TELEGRAM} target="_blank" rel="noopener">
                      Telegram
                    </a>
                  </>
                )}
              </span>
            </span>
          </li>
        ))}
      </ul>

      {settings.testimonials.length > 0 && (
        <>
          <h3 className="tst-h">{tr("Lo que dicen nuestros clientes")}</h3>
          <ul className="tst-grid">
            {settings.testimonials.map((t, i) => (
              <li key={i} className="tst">
                <Stars n={t.stars} />
                <blockquote>“{t.text}”</blockquote>
                <p className="tst-who">
                  <span className="tst-av" aria-hidden="true">
                    {(t.name || "?").trim().charAt(0).toUpperCase()}
                  </span>
                  <span>
                    <b>{t.name || tr("Cliente")}</b>
                    {t.place && <span> · {t.place}</span>}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
