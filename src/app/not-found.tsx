import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Página no encontrada", robots: { index: false } };

/** 404 con la marca de FormsBot: el logo, qué pasó y a dónde ir. */
export default function NotFound() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "32px 16px", background: "#F4F1FA", color: "#21163F", fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 460, textAlign: "center", background: "#fff", borderRadius: 18, borderTop: "8px solid #5B2EA6", padding: "36px 28px 30px", boxShadow: "0 18px 40px -24px rgba(33,22,63,.45)" }}>
        <svg viewBox="0 0 64 64" width="84" height="84" role="img" aria-label="FormsBot" style={{ display: "block", margin: "0 auto 14px" }}>
          <rect width="64" height="64" rx="14" fill="#5B2EA6" />
          <rect x="15" y="12" width="34" height="40" rx="6" fill="#fff" />
          <rect x="21" y="20" width="22" height="4" rx="2" fill="#5B2EA6" />
          <rect x="21" y="28" width="15" height="4" rx="2" fill="#C9BFDC" />
          <path d="M22 40.5l5.5 5.5L42 31.5" fill="none" stroke="#12A06A" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p style={{ margin: 0, fontWeight: 800, fontSize: 18, color: "#5B2EA6" }}>
          Forms<span style={{ color: "#21163F" }}>Bot</span>
        </p>
        <p style={{ margin: "18px 0 4px", fontSize: 64, fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 1, color: "#5B2EA6" }}>404</p>
        <h1 style={{ margin: "6px 0 8px", fontSize: 22, lineHeight: 1.25 }}>Esta página no existe</h1>
        <p style={{ margin: "0 0 22px", color: "#4F4666", fontSize: 15, lineHeight: 1.5 }}>
          Puede que el enlace esté mal escrito o que la página se haya movido.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="/" style={{ display: "inline-flex", alignItems: "center", minHeight: 44, padding: "0 18px", borderRadius: 10, fontWeight: 700, textDecoration: "none", background: "#5B2EA6", color: "#fff" }}>
            Ir a la herramienta
          </Link>
          <Link href="/mi-cuenta" style={{ display: "inline-flex", alignItems: "center", minHeight: 44, padding: "0 18px", borderRadius: 10, fontWeight: 700, textDecoration: "none", border: "1.5px solid #C9BFDC", color: "#21163F" }}>
            Mi cuenta
          </Link>
        </div>
      </div>
    </main>
  );
}
