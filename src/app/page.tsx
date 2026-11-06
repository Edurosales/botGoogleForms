import type { Metadata } from "next";
import HomeTool from "./HomeTool";
import SiteNav from "./SiteNav";
import { HomeIntro } from "./PageIntro";

// Portada estática (la sirve el CDN): `?url=` y `?pagado=` se leen en el
// navegador (ver HomeTool.tsx).

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

export default function HomePage() {
  return (
    <main className="tool-page">
      <SiteNav />
      <div className="tool-wrap">
        <HomeIntro />
        <HomeTool />
      </div>
    </main>
  );
}
