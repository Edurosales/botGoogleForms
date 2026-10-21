"use client";

import Link from "next/link";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="tool-page">
      <div className="tool-wrap">
        <div className="sheet">
          <div className="sheet-body">
            <h2>Esta página no cargó</h2>
            <p className="sheet-lead">Suele ser algo temporal. Vuelve a intentarlo; si sigue igual, recarga el navegador.</p>
            <div className="actions">
              <button type="button" className="b b-primary" onClick={() => reset()}>
                Reintentar
              </button>
              <Link className="b b-ghost" href="/">
                Ir al inicio
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
