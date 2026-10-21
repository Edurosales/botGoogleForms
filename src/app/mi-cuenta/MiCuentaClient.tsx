"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type User = { email: string; name: string; credits: number } | null;

export default function MiCuentaClient() {
  const [user, setUser] = useState<User | undefined>(undefined);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setUser(d.user ?? null))
      .catch(() => setUser(null));
  }, []);

  async function logout() {
    setLoggingOut(true);
    await fetch("/api/auth/me", { method: "POST" });
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/";
  }

  if (user === undefined) {
    return <div className="tool-card">Cargando…</div>;
  }

  if (user === null) {
    return (
      <div className="tool-card" style={{ textAlign: "center" }}>
        <p className="tool-sub">Todavía no has iniciado sesión.</p>
        <a className="btn wa" href="/api/auth/google?next=/mi-cuenta">
          Iniciar sesión con Google
        </a>
      </div>
    );
  }

  return (
    <div className="tool-card">
      <div className="tool-section" style={{ marginTop: 0, paddingTop: 0, borderTop: "none" }}>
        <h3>Tu cuenta</h3>
        <p className="tool-sub" style={{ marginBottom: 4 }}>{user.name || user.email}</p>
        <p className="tool-hint" style={{ marginTop: 0 }}>{user.email}</p>
      </div>

      <div className="tool-section">
        <h3>Créditos</h3>
        <p className="tool-sub" style={{ marginBottom: 16 }}>
          Tienes <b>{user.credits}</b> crédito{user.credits === 1 ? "" : "s"} disponibles. 1 crédito = 1 respuesta.
        </p>
        <a className="btn wa" href="/comprar-creditos">
          Comprar más créditos
        </a>
      </div>

      <div className="tool-section">
        <Link className="btn" href="/" style={{ display: "block", textAlign: "center", marginBottom: 10 }}>
          Ir a la herramienta
        </Link>
        <button className="btn ghost-link" onClick={logout} disabled={loggingOut}>
          {loggingOut ? "Cerrando sesión…" : "Cerrar sesión"}
        </button>
      </div>
    </div>
  );
}
