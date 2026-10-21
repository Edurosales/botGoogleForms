import type { Metadata } from "next";
import Link from "next/link";
import MiCuentaClient from "./MiCuentaClient";

export const metadata: Metadata = {
  title: "Mi cuenta",
  description: "Tu correo, tus créditos y tus envíos de FormsBot.",
};

export default function MiCuentaPage() {
  return (
    <main className="tool-page">
      <div className="w">
        <header className="tool-header">
          <Link className="logo" href="/">
            Forms<b>Bot</b>
          </Link>
          <h1>Mi cuenta</h1>
        </header>
        <MiCuentaClient />
      </div>
    </main>
  );
}
