"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useMe } from "./clientData";

const ADSENSE_CLIENT = "ca-pub-8213456831990505";

// Páginas donde nunca hay anuncios: donde se paga y la cuenta del cliente.
// Además de verse mal, un script publicitario de terceros en la página de
// pago es un riesgo (puede leer lo que pasa en la página).
const NO_ADS = ["/comprar-creditos", "/mi-cuenta"];

/**
 * Anuncios (AdSense + banners de Adsterra) solo para visitantes gratuitos y
 * fuera de las páginas de pago. Los clientes que ya pagaron nunca los ven.
 * Mientras se sabe quién es (sesión cargando), no se carga nada.
 */
export default function Ads() {
  const pathname = usePathname() ?? "/";
  const { me } = useMe();

  if (NO_ADS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;
  if (me === undefined) return null;
  if (me?.hasPaid) return null;

  return (
    <>
      <Script
        id="adsense-loader"
        strategy="afterInteractive"
        src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`}
        crossOrigin="anonymous"
      />
      {/* Adsterra — banner nativo con contenedor visible */}
      <div id="container-67a9cadc8bbd530b557716e84d977e60" className="ad-slot" />
      <Script async data-cfasync="false" src="https://bauval.org/21/67a9cadc8bbd530b557716e84d977e60" strategy="afterInteractive" />
      {/* Adsterra — banner 300x250 */}
      <Script id="adsterra-banner-options" strategy="afterInteractive">
        {`atOptions = { key: 'f59176d1f88f9f8bf808d89b44f66848', format: 'iframe', height: 250, width: 300, params: {} };`}
      </Script>
      <Script src="https://bauval.org/22/f59176d1f88f9f8bf808d89b44f66848" strategy="afterInteractive" />
    </>
  );
}
