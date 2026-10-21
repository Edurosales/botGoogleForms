import type { Metadata } from "next";
import Link from "next/link";
import HerramientaClient from "./HerramientaClient";
import SiteNav from "./SiteNav";

// Esta página lee `searchParams` directamente (para precargar el link
// pegado desde /sobre o un link viejo /herramienta?url=..., y el aviso de
// pago ?pagado=...). Bajo Cache Components eso vuelve la página dinámica —
// se permite explícitamente en vez de forzarla detrás de un <Suspense>
// (que dejaría el formulario invisible hasta que el navegador hidrate).
export const instant = false;

export const metadata: Metadata = {
  title: "FormsBot — Prueba tu Google Form con respuestas automáticas",
  description:
    "Pega el link de tu Google Form público y recibe respuestas de prueba en minutos. Tu primera vez es gratis; con créditos se activan las respuestas con IA.",
  alternates: { canonical: "https://bot-google-forms-servicio.vercel.app/" },
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
        <div className="intro">
          <h1>Llena tu Google Form de prueba</h1>
          <p>
            Pega el link, revisa cómo se responde cada pregunta y envía. Tu primera vez es gratis.{" "}
            <Link href="/sobre">Cómo funciona</Link>
          </p>
        </div>
        <HerramientaClient initialUrl={initialUrl} paidOrder={paidOrder} />
      </div>
    </main>
  );
}
