"use client";

import { useEffect, useState } from "react";
import HerramientaClient from "./HerramientaClient";
import PurchaseCelebration from "./PurchaseCelebration";

/**
 * Herramienta de la portada. `?url=` (link precargado desde /sobre o un link
 * viejo /herramienta?url=…) y `?pagado=` (volver de pagar) se leen aquí, en el
 * navegador, y no en el servidor: así la portada es estática y la sirve el CDN
 * sin ejecutar ninguna función de Vercel en cada visita.
 * Sin esos parámetros (casi todas las visitas) se ve y funciona igual que antes;
 * con ellos, la herramienta se vuelve a montar una vez, ya con esos datos.
 */
export default function HomeTool() {
  const [query, setQuery] = useState<{ url: string; paid: string } | null>(null);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const url = (sp.get("url") ?? "").slice(0, 500);
    const paid = (sp.get("pagado") ?? "").slice(0, 64);
    if (url || paid) void Promise.resolve().then(() => setQuery({ url, paid }));
  }, []);

  return (
    <>
      <HerramientaClient key={query ? "con-datos" : "base"} initialUrl={query?.url ?? ""} paidOrder={query?.paid ?? ""} />
      <PurchaseCelebration orderId={query?.paid || null} />
    </>
  );
}
