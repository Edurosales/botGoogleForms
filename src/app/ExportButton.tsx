"use client";

import { useState } from "react";
import Link from "next/link";

type Preview = { header: string[]; rows: string[][]; total: number };

/**
 * "Exportar a Excel": clientes de pago descargan el .xlsx; los gratuitos ven
 * el botón con candado y una vista previa difuminada de lo que obtendrían.
 */
export default function ExportButton({ jobId, premium, small = false }: { jobId: string; premium: boolean; small?: boolean }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function openPreview() {
    setLoading(true);
    setError("");
    try {
      const r = await fetch(`/api/web/jobs/${jobId}/export?preview=1`, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (d.ok) setPreview({ header: d.header, rows: d.rows, total: d.total });
      else setError(String(d.error || "No se pudo cargar la vista previa."));
    } finally {
      setLoading(false);
    }
  }

  const cls = `b b-ghost${small ? " b-small" : ""}`;
  if (premium) {
    return (
      <a className={cls} href={`/api/web/jobs/${jobId}/export`} download>
        Exportar a Excel
      </a>
    );
  }

  return (
    <>
      <button type="button" className={`${cls} is-locked`} onClick={openPreview} disabled={loading}>
        <span aria-hidden="true">🔒</span> Exportar a Excel
      </button>
      {error && <p className="fine">{error}</p>}
      {preview && (
        <div className="paymodal" role="dialog" aria-modal="true" aria-labelledby={`xp-${jobId}`}>
          <div className="paymodal-backdrop" onClick={() => setPreview(null)} />
          <div className="paymodal-card fh-card xp-card">
            <div className="paymodal-head fh-head">
              <div>
                <p className="paymodal-kicker">Función Premium</p>
                <h2 id={`xp-${jobId}`}>Tus {preview.total} respuestas en Excel</h2>
              </div>
              <button type="button" className="paymodal-x" aria-label="Cerrar" onClick={() => setPreview(null)}>
                ×
              </button>
            </div>
            <p className="fh-why">
              Descarga en un .xlsx cada respuesta que enviamos, con su estado: ideal para revisar tus gráficos, compartir la
              prueba o guardar evidencia. Se activa al comprar cualquier paquete de créditos.
            </p>
            <div className="xp-table" aria-hidden="true">
              <table>
                <thead>
                  <tr>
                    {preview.header.slice(0, 5).map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r, i) => (
                    <tr key={i} className={i > 0 ? "xp-blur" : undefined}>
                      {r.slice(0, 5).map((c, j) => (
                        <td key={j}>{c}</td>
                      ))}
                    </tr>
                  ))}
                  <tr className="xp-blur">
                    <td colSpan={Math.min(5, preview.header.length)}>… y {Math.max(0, preview.total - preview.rows.length)} filas más</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="fh-actions">
              <Link className="b b-primary" href="/comprar-creditos">
                Comprar créditos y desbloquear
              </Link>
              <button type="button" className="b b-ghost" onClick={() => setPreview(null)}>
                Ahora no
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
