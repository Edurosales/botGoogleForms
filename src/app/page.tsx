import type { Metadata } from "next";
import Link from "next/link";
import HerramientaClient from "./HerramientaClient";

// Esta página lee `searchParams` directamente (para precargar el link
// pegado desde /sobre o un link viejo /herramienta?url=...). Bajo Cache
// Components eso vuelve la página dinámica — se permite explícitamente
// en vez de forzarla detrás de un <Suspense> (que dejaría el formulario
// invisible hasta que el navegador hidrate, un "flash" confuso justo en
// la página principal).
export const instant = false;

export const metadata: Metadata = {
  title: "FormsBot — Prueba tu Google Form gratis con IA",
  description:
    "Pega el link de tu Google Form público y recibe respuestas generadas por IA para probarlo antes de lanzarlo. Hasta 30 respuestas gratis.",
  alternates: { canonical: "https://bot-google-forms.vercel.app/" },
  openGraph: {
    type: "website",
    title: "FormsBot — Prueba tu Google Form gratis con IA",
    description: "Pega el link de tu Google Form y recibe respuestas reales generadas por IA.",
    url: "https://bot-google-forms.vercel.app/",
    images: ["https://bot-google-forms.vercel.app/soft.png"],
  },
};

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const initialUrl = typeof sp.url === "string" ? sp.url : "";

  return (
    <main className="tool-page">
      <div className="w">
        <header className="tool-header">
          <Link className="logo" href="/">
            Forms<b>Bot</b>
          </Link>
          <h1>Prueba tu Google Form</h1>
          <p className="lead">
            Pega el link público de tu formulario. Generamos respuestas con IA y las enviamos por ti —
            hasta 30 respuestas gratis (con espera si el servidor está ocupado), o compra créditos para
            más y saltar la cola.{" "}
            <Link href="/sobre#features">¿Quieres saber más sobre FormsBot?</Link>
          </p>
        </header>
        <HerramientaClient initialUrl={initialUrl} />
      </div>
    </main>
  );
}
