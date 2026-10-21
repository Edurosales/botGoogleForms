"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type User = { email: string; name: string; credits: number } | null;

export default function AccountBar() {
  const [user, setUser] = useState<User | undefined>(undefined);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setUser(d.user ?? null))
      .catch(() => setUser(null));
  }, []);

  if (user === undefined) return <div className="account-bar" aria-hidden="true" />;

  if (user === null) {
    return (
      <div className="account-bar">
        <a className="btn wa account-login" href="/api/auth/google?next=/">
          Iniciar sesión
        </a>
      </div>
    );
  }

  const initial = (user.name || user.email).trim().charAt(0).toUpperCase();

  return (
    <div className="account-bar">
      <span className="account-credits">{user.credits} crédito{user.credits === 1 ? "" : "s"}</span>
      <Link href="/comprar-creditos" className="account-link">
        Comprar más
      </Link>
      <Link href="/mi-cuenta" className="account-avatar" title={user.email} aria-label="Mi cuenta">
        {initial}
      </Link>
    </div>
  );
}
