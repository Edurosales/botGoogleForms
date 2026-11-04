/**
 * Banderas pequeñas para el precio de referencia en otras monedas. SVG propio:
 * en Windows los emojis de bandera se ven como letras ("US"), no como bandera.
 */
const FLAGS: Record<string, React.ReactNode> = {
  PEN: (
    <>
      <rect width="21" height="14" fill="#fff" />
      <rect width="7" height="14" fill="#D91023" />
      <rect x="14" width="7" height="14" fill="#D91023" />
    </>
  ),
  USD: (
    <>
      <rect width="21" height="14" fill="#fff" />
      {[0, 2, 4, 6, 8, 10, 12].map((y) => (
        <rect key={y} y={y} width="21" height="1.08" fill="#B22234" />
      ))}
      <rect width="9" height="7.5" fill="#3C3B6E" />
    </>
  ),
  EUR: (
    <>
      <rect width="21" height="14" fill="#003399" />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return <circle key={i} cx={10.5 + Math.cos(a) * 4} cy={7 + Math.sin(a) * 4} r="0.7" fill="#FFCC00" />;
      })}
    </>
  ),
  MXN: (
    <>
      <rect width="7" height="14" fill="#006847" />
      <rect x="7" width="7" height="14" fill="#fff" />
      <rect x="14" width="7" height="14" fill="#CE1126" />
      <circle cx="10.5" cy="7" r="1.6" fill="#8C5A2B" />
    </>
  ),
  COP: (
    <>
      <rect width="21" height="7" fill="#FCD116" />
      <rect y="7" width="21" height="3.5" fill="#003893" />
      <rect y="10.5" width="21" height="3.5" fill="#CE1126" />
    </>
  ),
  CLP: (
    <>
      <rect width="21" height="7" fill="#fff" />
      <rect y="7" width="21" height="7" fill="#D52B1E" />
      <rect width="7" height="7" fill="#0039A6" />
      <circle cx="3.5" cy="3.5" r="1.3" fill="#fff" />
    </>
  ),
  ARS: (
    <>
      <rect width="21" height="14" fill="#74ACDF" />
      <rect y="4.67" width="21" height="4.67" fill="#fff" />
      <circle cx="10.5" cy="7" r="1.5" fill="#F6B40E" />
    </>
  ),
  BOB: (
    <>
      <rect width="21" height="4.67" fill="#D52B1E" />
      <rect y="4.67" width="21" height="4.67" fill="#F9E300" />
      <rect y="9.33" width="21" height="4.67" fill="#007934" />
    </>
  ),
};

export default function Flag({ code }: { code: string }) {
  const f = FLAGS[code];
  if (!f) return null;
  return (
    <svg className="flag" viewBox="0 0 21 14" width="21" height="14" aria-hidden="true" focusable="false">
      {f}
    </svg>
  );
}
