import type { Metadata } from "next";
import Script from "next/script";
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
    <html lang="es" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#F6F5F9" />
        {/* Menú de la app visible desde el primer pintado si este navegador tenía sesión
            (SiteNav lo confirma o lo quita al saber la sesión real). */}
        <script
          dangerouslySetInnerHTML={{
            __html: "try{var d=document.documentElement;if(localStorage.getItem('fb-sess')==='1')d.classList.add('sess');if(localStorage.getItem('fb-side-mini')==='1')d.classList.add('side-mini')}catch(e){}",
          }}
        />
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
        {/* Medición solo con "Aceptar" en el banner (ver Analytics.tsx). Sin anuncios en el sitio. */}
        <Analytics />
        {children}

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
