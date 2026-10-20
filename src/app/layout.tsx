import type { Metadata } from "next";
import Script from "next/script";

const GA_ID = "G-4WCK4EME75";
const ADSENSE_CLIENT = "ca-pub-8213456831990505";

export const metadata: Metadata = {
  metadataBase: new URL("https://bot-google-forms.vercel.app"),
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
        <Script
          id="adsense-loader"
          strategy="afterInteractive"
          src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`}
          crossOrigin="anonymous"
        />
        {children}

        <div className="cookie" role="dialog" aria-label="Preferencias de cookies">
          <p>
            Usamos cookies necesarias y medición anónima para mejorar el sitio. Puedes consultar
            nuestra <a href="/privacidad.html">política de privacidad</a>.
          </p>
          <button className="btn" type="button" data-cookie-accept="">
            Aceptar
          </button>
        </div>

        <Script src="/script.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
