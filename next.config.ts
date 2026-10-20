import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  async redirects() {
    return [
      // La herramienta vivía en /herramienta; ahora es la portada. El
      // querystring (ej. ?url=...) se reenvía solo a /.
      { source: "/herramienta", destination: "/", permanent: false },
    ];
  },
};

export default nextConfig;
