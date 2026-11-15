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
    canonical: "https://www.formsbot.app/",
    languages: {
      es: "https://www.formsbot.app/",
      en: "https://www.formsbot.app/en",
      pt: "https://www.formsbot.app/pt",
      it: "https://www.formsbot.app/it",
      fr: "https://www.formsbot.app/fr",
      "x-default": "https://www.formsbot.app/en",
    },
  },
  openGraph: {
    type: "website",
    title: "FormsBot — Prueba tu Google Form con respuestas automáticas",
    description: "Pega el link de tu Google Form y recibe respuestas de prueba en minutos.",
    url: "https://www.formsbot.app/",
    images: ["https://www.formsbot.app/soft.png"],
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
