import type { Metadata } from "next";
import Script from "next/script";
import Ads from "./Ads";
import Analytics from "./Analytics";
import SupportButton from "./SupportButton";
import ConsentGate from "./ConsentGate";
import SiteBanner from "./SiteBanner";
import InvitedNote from "./InvitedNote";
import ReferralFab from "./ReferralFab";
import BannedGate from "./BannedGate";
import CookieNotice from "./CookieNotice";
import { LangProvider } from "./LangProvider";


export const metadata: Metadata = {
  metadataBase: new URL("https://bot-google-forms-servicio.vercel.app"),
  title: {
    default: "FormsBot (Bot Forms) — Prueba tu Google Form con respuestas automáticas",
    template: "%s · FormsBot",
  },
  applicationName: "FormsBot",
  description:
    "FormsBot (también conocido como Bot Forms) envía respuestas de prueba a tu propio Google Form: aleatorias, fijas, por porcentajes o con IA en 5 idiomas, siguiendo cada sección. La primera prueba es gratis.",
  keywords: ["FormsBot", "Bot Forms", "BotForms", "Forms Bot", "bot para Google Forms", "probar Google Forms", "respuestas de prueba", "Google Forms test"],
  alternates: {
    languages: {
      es: "https://bot-google-forms-servicio.vercel.app/",
      en: "https://bot-google-forms-servicio.vercel.app/en",
      pt: "https://bot-google-forms-servicio.vercel.app/pt",
      it: "https://bot-google-forms-servicio.vercel.app/it",
      fr: "https://bot-google-forms-servicio.vercel.app/fr",
      "x-default": "https://bot-google-forms-servicio.vercel.app/en",
    },
  },
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
        <LangProvider>
        <SiteBanner />
        <InvitedNote />
        {/* Medición y anuncios solo con "Aceptar" en el banner (ver Analytics.tsx y Ads.tsx). */}
        <Analytics />
        {/* Los formatos invasivos de Adsterra (popunder / social bar) NO van en el
            layout global: probado en vivo, el popunder abre una pestaña de
            publicidad en el primer clic (el campo del link, "Leer formulario") y
            la herramienta parece no responder; el social bar además cambia el
            título de la pestaña a "(1) New Message!". Siguen en /sobre. */}
        {children}

        {/* Anuncios solo para visitantes gratuitos y fuera de las páginas de pago (ver Ads.tsx). */}
        <Ads />
        <SupportButton />
        <ReferralFab />
        <ConsentGate />
        <BannedGate />

        <CookieNotice />

        </LangProvider>
        <Script src="/script.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
