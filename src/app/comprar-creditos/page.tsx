import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getAppSettings } from "@/lib/appSettings";
import ComprarCreditosClient from "./ComprarCreditosClient";

export const metadata: Metadata = {
  title: "Comprar créditos",
  description: "Compra créditos para enviar más respuestas y saltar la cola gratis de FormsBot.",
};

async function CreditPackagesLoader() {
  const settings = await getAppSettings();
  return <ComprarCreditosClient packages={settings.credit_packages} />;
}

export default function ComprarCreditosPage() {
  return (
    <main className="tool-page">
      <div className="w">
        <header className="tool-header">
          <Link className="logo" href="/">
            Forms<b>Bot</b>
          </Link>
          <h1>Comprar créditos</h1>
          <p className="lead">1 crédito = 1 respuesta. Los créditos tienen prioridad: nunca esperan detrás de la cola gratis.</p>
        </header>
        <Suspense fallback={<div className="tool-card">Cargando paquetes…</div>}>
          <CreditPackagesLoader />
        </Suspense>
      </div>
    </main>
  );
}
