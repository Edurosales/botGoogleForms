import type { Metadata } from "next";
import Link from "next/link";
import MiCuentaClient from "./MiCuentaClient";
import AccountBar from "../AccountBar";

export const metadata: Metadata = {
  title: "Mi cuenta",
  description: "Tu correo, tus créditos y tus envíos de FormsBot.",
};

export default function MiCuentaPage() {
  return (
    <main className="tool-page">
      <div className="w">
        <div className="tool-topbar">
          <Link className="logo" href="/">
            Forms<b>Bot</b>
          </Link>
          <AccountBar />
        </div>
        <header className="tool-header">
          <h1>Mi cuenta</h1>
        </header>
        <MiCuentaClient />
      </div>
    </main>
  );
}
