import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { getAppSettings } from "@/lib/appSettings";
import ComprarCreditosClient from "./ComprarCreditosClient";
import SiteNav from "../SiteNav";
import { StoreIntro } from "../PageIntro";

export const metadata: Metadata = {
  title: "Comprar créditos",
  description: "Compra créditos para enviar más respuestas, usar IA y saltar la fila gratuita de FormsBot.",
};

async function CreditPackagesLoader() {
  // En tiempo de petición, para que los precios que edita el admin se vean sin redeploy.
  await connection();
  const settings = await getAppSettings();
  return <ComprarCreditosClient packages={settings.credit_packages} />;
}

export default function ComprarCreditosPage() {
  return (
    <main className="tool-page">
      <SiteNav />
      <div className="tool-wrap tool-wrap-wide">
        <StoreIntro />
        <Suspense
          fallback={
            <div className="sheet">
              <div className="sheet-body">
                <p className="sheet-lead">Cargando paquetes…</p>
              </div>
            </div>
          }
        >
          <CreditPackagesLoader />
        </Suspense>
      </div>
    </main>
  );
}
