import type { Metadata } from "next";
import Script from "next/script";
import Ads from "./Ads";
import SupportButton from "./SupportButton";
import ConsentGate from "./ConsentGate";

const GA_ID = "G-4WCK4EME75";

export const metadata: Metadata = {
  metadataBase: new URL("https://bot-google-forms-servicio.vercel.app"),
  title: {
    default: "FormsBot — Rellena Google Forms automáticamente con IA",
    template: "%s · FormsBot",
  },
  description:
    "Bot que rellena Google Forms con respuestas reales usando IA. 50 respuestas en menos de 2 minutos. Servicio desde S/25 o software por S/300. Lima, Perú.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es">
      <head>
        <meta name="theme-color" content="#F0EBF8" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&display=swap"
          rel="stylesheet"
        />
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body>
        {/* Consent Mode debe fijarse ANTES de que carguen los scripts de GA/AdSense */}
        <Script id="consent-default" strategy="beforeInteractive">
          {`window.dataLayer = window.dataLayer || []; function gtag() { dataLayer.push(arguments) } gtag('consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', wait_for_update: 500 });`}
        </Script>
        <Script
          id="ga-loader"
          strategy="afterInteractive"
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
        />
        <Script id="ga-config" strategy="afterInteractive">
          {`gtag('js', new Date()); gtag('config', '${GA_ID}');`}
        </Script>
        {/* Los formatos invasivos de Adsterra (popunder / social bar) NO van en el
            layout global: probado en vivo, el popunder abre una pestaña de
            publicidad en el primer clic (el campo del link, "Leer formulario") y
            la herramienta parece no responder; el social bar además cambia el
            título de la pestaña a "(1) New Message!". Siguen en /sobre. */}
        {children}

        {/* Anuncios solo para visitantes gratuitos y fuera de las páginas de pago (ver Ads.tsx). */}
        <Ads />
        <SupportButton />
        <ConsentGate />

        <div className="cookie" role="dialog" aria-label="Preferencias de cookies">
          <p>
            Usamos cookies necesarias para que el sitio funcione y, solo si aceptas, cookies de medición
            (Google Analytics) y de publicidad. Puedes rechazarlas sin perder ninguna función. Más en la{" "}
            <a href="/privacidad.html">política de privacidad</a>.
          </p>
          <div className="cookie-actions">
            <button className="btn btn-ghost" type="button" data-cookie-reject="">
              Rechazar
            </button>
            <button className="btn" type="button" data-cookie-accept="">
              Aceptar
            </button>
          </div>
        </div>

        <Script src="/script.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
