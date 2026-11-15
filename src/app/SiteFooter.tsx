"use client";

/**
 * Pie de todas las páginas de la app (herramienta, tienda, pago, cuenta):
 * nombre del negocio, correo de contacto visible y enlaces legales
 * (términos, privacidad, reembolsos y entrega). Lo exigen las pasarelas
 * de pago (dLocal Go) para aprobar la cuenta, y da confianza al comprar.
 */
import { legalHref } from "@/lib/i18n";
import { useLang } from "./LangProvider";
import { SUPPORT_EMAIL, SUPPORT_TELEGRAM } from "./clientData";

export default function SiteFooter() {
  const { tr, locale } = useLang();
  return (
    <footer className="app-foot">
      <p>
        <b>FormsBot</b> · {tr("Herramienta para probar tus propios Google Forms")} · Lima, Perú
      </p>
      <p>
        {tr("Contacto")}: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> ·{" "}
        <a href={SUPPORT_TELEGRAM} target="_blank" rel="noopener">
          Telegram
        </a>
      </p>
      <div className="footer-links" role="navigation" aria-label={tr("Enlaces legales")}>
        <a href={legalHref(locale, "terms")}>{tr("Términos del servicio")}</a>
        <a href={legalHref(locale, "privacy")}>{tr("Política de privacidad")}</a>
        <a href="/reembolsos.html">{tr("Reembolsos y entrega")}</a>
        <a href={locale === "es" ? "/sobre" : `/${locale}`}>{tr("Sobre FormsBot")}</a>
        <a href="/guias.html">{tr("Guías")}</a>
      </div>
      <p className="fine">© 2026 FormsBot</p>
    </footer>
  );
}
