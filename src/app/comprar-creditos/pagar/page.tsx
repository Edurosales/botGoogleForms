import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { getAppSettings } from "@/lib/appSettings";
import PagarClient from "./PagarClient";
import SiteNav from "../../SiteNav";

export const metadata: Metadata = {
  title: "Finalizar compra",
  description: "Pago seguro de créditos de FormsBot con tarjeta de crédito o débito.",
  robots: { index: false },
};

async function Loader() {
  // En tiempo de petición, para que los precios que edita el admin se vean sin redeploy.
  await connection();
  const settings = await getAppSettings();
  return <PagarClient packages={settings.credit_packages} />;
}

export default function PagarPage() {
  return (
    <main className="tool-page">
      <SiteNav />
      <div className="tool-wrap tool-wrap-wide">
        <Suspense
          fallback={
            <div className="sheet">
              <div className="sheet-body">
                <p className="sheet-lead">Cargando…</p>
              </div>
            </div>
          }
        >
          <Loader />
        </Suspense>
      </div>
    </main>
  );
}
