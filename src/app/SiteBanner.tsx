"use client";

import { usePublicSettings } from "./clientData";

/** Tira de aviso del admin (mantenimiento, promos…) arriba de todo el sitio. */
export default function SiteBanner() {
  const { banner } = usePublicSettings();
  if (!banner) return null;
  return (
    <div className={`site-banner site-banner-${banner.kind}`} role="status">
      <span className="site-banner-track">{banner.message}</span>
    </div>
  );
}
