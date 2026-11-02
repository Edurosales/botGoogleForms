import type { Metadata } from "next";
import SiteNav from "../SiteNav";
import InvitaClient from "./InvitaClient";
import { SimpleIntro } from "../PageIntro";

export const metadata: Metadata = {
  title: "Invita y gana",
  description: "Comparte tu enlace de FormsBot: cuando tu invitado hace su primera compra, los dos reciben créditos.",
  robots: { index: false },
};

export default function InvitaPage() {
  return (
    <main className="tool-page">
      <SiteNav />
      <div className="tool-wrap">
        <SimpleIntro title="Invita y gana" lead="Comparte tu enlace. Cuando alguien se registra con él y hace su primera compra, los dos reciben créditos." />
        <InvitaClient />
      </div>
    </main>
  );
}
