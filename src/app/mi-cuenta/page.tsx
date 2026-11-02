import type { Metadata } from "next";
import MiCuentaClient from "./MiCuentaClient";
import SiteNav from "../SiteNav";
import { SimpleIntro } from "../PageIntro";

export const metadata: Metadata = {
  title: "Mi cuenta",
  description: "Tus créditos, cupones y envíos de FormsBot.",
  robots: { index: false },
};

export default function MiCuentaPage() {
  return (
    <main className="tool-page">
      <SiteNav />
      <div className="tool-wrap">
        <SimpleIntro title="Mi cuenta" />
        <MiCuentaClient />
      </div>
    </main>
  );
}
