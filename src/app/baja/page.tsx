import type { Metadata } from "next";
import SiteNav from "../SiteNav";
import BajaClient from "./BajaClient";

export const metadata: Metadata = {
  title: "Darse de baja del boletín",
  robots: { index: false },
};

export default function BajaPage() {
  return (
    <main className="tool-page">
      <SiteNav />
      <div className="tool-wrap">
        <div className="intro">
          <h1>Boletín de FormsBot</h1>
        </div>
        <BajaClient />
      </div>
    </main>
  );
}
