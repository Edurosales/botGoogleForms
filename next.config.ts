import type { NextConfig } from "next";

// ¿Ya se apunta al dominio propio? (SITE_URL en Vercel = https://www.formsbot.app)
const NEW_DOMAIN_LIVE = /formsbot\.app/i.test(process.env.SITE_URL || "");

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  async redirects() {
    return [
      // La herramienta vivía en /herramienta; ahora es la portada. El
      // querystring (ej. ?url=...) se reenvía solo a /.
      { source: "/herramienta", destination: "/", permanent: false },
      // Dominio propio: las PÁGINAS del dominio viejo de Vercel van a
      // www.formsbot.app (mismo camino y querystring). /api/* sigue
      // funcionando en el viejo: cron del worker, avisos de pago (Izipay,
      // Mercado Pago, dLocal Go) y pagos que ya estaban en curso.
      // Se hace aquí (borde de Vercel) y no con middleware: no gasta invocaciones.
      // Solo se activa cuando SITE_URL ya es el dominio nuevo (si no, el login
      // con Google volvería al dominio viejo y la sesión no cuadraría).
      ...(NEW_DOMAIN_LIVE
        ? [
            {
              source: "/",
              has: [{ type: "host" as const, value: "bot-google-forms-servicio.vercel.app" }],
              destination: "https://www.formsbot.app/",
              permanent: true,
            },
            {
              source: "/:path((?!api/).*)",
              has: [{ type: "host" as const, value: "bot-google-forms-servicio.vercel.app" }],
              destination: "https://www.formsbot.app/:path",
              permanent: true,
            },
          ]
        : []),
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Nadie puede cargar el sitio dentro de un iframe ajeno (clickjacking
          // sobre "Enviar" o la compra).
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          // AdSense, Adsterra e Izipay cargan scripts de dominios que cambian: no se
          // restringe script-src (no hay puntos de XSS: React escapa todo), sí lo
          // que protege sin romper anuncios ni pagos.
          {
            key: "Content-Security-Policy",
            value:
              "object-src 'none'; base-uri 'self'; frame-ancestors 'self'; upgrade-insecure-requests",
          },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
          { key: "Cross-Origin-Resource-Policy", value: "same-site" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        // Las respuestas de la API nunca deben quedar en cachés intermedias,
        // salvo la configuración pública (igual para todos; ver su ruta).
        source: "/api/:path((?!web/settings/public).*)",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
