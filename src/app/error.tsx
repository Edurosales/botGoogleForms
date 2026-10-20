"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="tool-page">
      <div className="w">
        <div className="tool-card">
          <h2>Algo falló</h2>
          <p className="lead">No se pudo cargar esta página. Puede ser temporal.</p>
          <button className="btn wa" onClick={() => reset()}>
            Reintentar
          </button>
        </div>
      </div>
    </div>
  );
}
