import type { Metadata } from "next";
import HerramientaClient from "./HerramientaClient";
import PurchaseCelebration from "./PurchaseCelebration";
import SiteNav from "./SiteNav";
import { HomeIntro } from "./PageIntro";

// Esta página lee `searchParams` directamente (para precargar el link
// pegado desde /sobre o un link viejo /herramienta?url=..., y el aviso de
// pago ?pagado=...). Bajo Cache Components eso vuelve la página dinámica —
// se permite explícitamente en vez de forzarla detrás de un <Suspense>
// (que dejaría el formulario invisible hasta que el navegador hidrate).
export const instant = false;

export const metadata: Metadata = {
  title: { absolute: "FormsBot (Bot Forms) — Prueba tu Google Form con respuestas automáticas" },
  description:
    "FormsBot (Bot Forms): pega el link de tu propio Google Form y recibe respuestas de prueba en minutos, siguiendo cada sección. Tu primera vez es gratis; con créditos se activan las respuestas con IA en 5 idiomas.",
  alternates: {
    canonical: "https://bot-google-forms-servicio.vercel.app/",
    languages: {
      es: "https://bot-google-forms-servicio.vercel.app/",
      en: "https://bot-google-forms-servicio.vercel.app/en",
      pt: "https://bot-google-forms-servicio.vercel.app/pt",
      it: "https://bot-google-forms-servicio.vercel.app/it",
      fr: "https://bot-google-forms-servicio.vercel.app/fr",
      "x-default": "https://bot-google-forms-servicio.vercel.app/en",
    },
  },
  openGraph: {
    type: "website",
    title: "FormsBot — Prueba tu Google Form con respuestas automáticas",
    description: "Pega el link de tu Google Form y recibe respuestas de prueba en minutos.",
    url: "https://bot-google-forms-servicio.vercel.app/",
    images: ["https://bot-google-forms-servicio.vercel.app/soft.png"],
  },
};

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const initialUrl = typeof sp.url === "string" ? sp.url.slice(0, 500) : "";
  const paidOrder = typeof sp.pagado === "string" ? sp.pagado.slice(0, 64) : "";

  return (
    <main className="tool-page">
      <SiteNav />
      <div className="tool-wrap">
        <HomeIntro />
        <HerramientaClient initialUrl={initialUrl} paidOrder={paidOrder} />
        <PurchaseCelebration orderId={paidOrder || null} />
      </div>
    </main>
  );
}
