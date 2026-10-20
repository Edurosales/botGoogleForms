import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import HerramientaClient from "./HerramientaClient";

export const metadata: Metadata = {
  title: "Prueba tu Google Form gratis",
  description:
    "Pega el link de tu Google Form público y recibe respuestas generadas por IA para probarlo antes de lanzarlo. Fase de pruebas.",
};

export default function HerramientaPage() {
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
            <Link href="/#features">¿Quieres saber más sobre FormsBot?</Link>
          </p>
        </header>
        <Suspense fallback={null}>
          <HerramientaClient />
        </Suspense>
      </div>
    </main>
  );
}
