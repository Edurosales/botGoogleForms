"use client";

import Script from "next/script";
import { useCookieConsent } from "./clientData";

const GA_ID = "G-4WCK4EME75";

/**
 * Google Analytics SOLO después de "Aceptar" en el banner de cookies: si la
 * persona rechaza (o no elige), el script de Google ni siquiera se descarga.
 */
export default function Analytics() {
  const consent = useCookieConsent();
  if (consent !== "accepted") return null;
  return (
    <>
      <Script id="ga-consent" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || []; function gtag(){dataLayer.push(arguments)} window.gtag = gtag; gtag('consent','default',{analytics_storage:'granted',ad_storage:'granted',ad_user_data:'granted',ad_personalization:'granted'}); gtag('js', new Date()); gtag('config', '${GA_ID}');`}
      </Script>
      <Script id="ga-loader" strategy="afterInteractive" src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} />
    </>
  );
}
