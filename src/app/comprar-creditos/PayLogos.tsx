/**
 * Insignias de los medios de pago (SVG en línea: sin pedir imágenes a otros
 * sitios, nítidas en cualquier pantalla). Solo se muestran los medios que de
 * verdad están activos en la tienda.
 */
type Brand = "visa" | "mastercard" | "amex" | "diners" | "mercadopago" | "yape" | "pagoefectivo";

const NAME: Record<Brand, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  diners: "Diners Club",
  mercadopago: "Mercado Pago",
  yape: "Yape",
  pagoefectivo: "PagoEfectivo",
};

function Svg({ brand, wide = false }: { brand: Brand; wide?: boolean }) {
  const w = wide ? 74 : 44;
  const box = { width: w, height: 28, viewBox: `0 0 ${w} 28`, role: "img" as const, "aria-label": NAME[brand], className: "paylogo" };
  switch (brand) {
    case "visa":
      return (
        <svg {...box}>
          <rect x=".5" y=".5" width={w - 1} height="27" rx="5" fill="#fff" stroke="#D9D4E6" />
          <text x={w / 2} y="19" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontSize="13" fontWeight="900" fontStyle="italic" fill="#1A1F71" letterSpacing=".5">
            VISA
          </text>
        </svg>
      );
    case "mastercard":
      return (
        <svg {...box}>
          <rect x=".5" y=".5" width={w - 1} height="27" rx="5" fill="#fff" stroke="#D9D4E6" />
          <circle cx="17.5" cy="14" r="8" fill="#EB001B" />
          <circle cx="26.5" cy="14" r="8" fill="#F79E1B" />
          <path d="M22 7.4a8 8 0 0 1 0 13.2 8 8 0 0 1 0-13.2Z" fill="#FF5F00" />
        </svg>
      );
    case "amex":
      return (
        <svg {...box}>
          <rect width={w} height="28" rx="5" fill="#2E77BC" />
          <text x={w / 2} y="18.5" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontSize="10" fontWeight="900" fill="#fff" letterSpacing=".4">
            AMEX
          </text>
        </svg>
      );
    case "diners":
      return (
        <svg {...box}>
          <rect x=".5" y=".5" width={w - 1} height="27" rx="5" fill="#fff" stroke="#D9D4E6" />
          <circle cx="22" cy="14" r="9" fill="#0079BE" />
          <circle cx="18.6" cy="14" r="5.4" fill="#fff" />
          <circle cx="25.4" cy="14" r="5.4" fill="#fff" />
          <circle cx="22" cy="14" r="2.6" fill="#0079BE" />
        </svg>
      );
    case "mercadopago":
      return (
        <svg {...box}>
          <rect width={w} height="28" rx="5" fill="#009EE3" />
          <ellipse cx="14" cy="14" rx="9" ry="6.5" fill="#fff" />
          <path d="M8.5 14.2c1.6-1.4 3.3-1.6 5.2-.4 1.6 1 3.2 1 4.8-.2" fill="none" stroke="#009EE3" strokeWidth="1.6" strokeLinecap="round" />
          <text x="27" y="12.5" fontFamily="Arial, Helvetica, sans-serif" fontSize="8.5" fontWeight="800" fill="#fff">mercado</text>
          <text x="27" y="22" fontFamily="Arial, Helvetica, sans-serif" fontSize="8.5" fontWeight="800" fill="#fff">pago</text>
        </svg>
      );
    case "yape":
      return (
        <svg {...box}>
          <rect width={w} height="28" rx="5" fill="#742284" />
          <text x={w / 2} y="18.5" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontSize="13" fontWeight="900" fill="#fff">
            yape
          </text>
        </svg>
      );
    case "pagoefectivo":
      return (
        <svg {...box}>
          <rect width={w} height="28" rx="5" fill="#FFD100" />
          <text x={w / 2} y="17.5" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontSize="8.6" fontWeight="900" fill="#1F1F1F">
            PagoEfectivo
          </text>
        </svg>
      );
  }
}

export const IZIPAY_BRANDS: Brand[] = ["visa", "mastercard", "amex", "diners"];
export const MP_BRANDS: Brand[] = ["mercadopago", "yape", "pagoefectivo"];

export function PayLogos({ brands, label }: { brands: Brand[]; label?: string }) {
  return (
    <span className="paylogos" aria-label={label ?? `Acepta: ${brands.map((b) => NAME[b]).join(", ")}`}>
      {brands.map((b) => (
        <Svg key={b} brand={b} wide={b === "mercadopago" || b === "pagoefectivo"} />
      ))}
    </span>
  );
}

/** Franja de confianza bajo el botón de pagar: candado + medios activos. */
export function SecurePayStrip({ providers }: { providers: readonly string[] }) {
  const brands: Brand[] = [
    ...(providers.includes("mercadopago") ? MP_BRANDS : []),
    ...(providers.includes("izipay") ? IZIPAY_BRANDS : []),
  ];
  if (!brands.length) return null;
  return (
    <div className="paysecure">
      <span className="paysecure-lock">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Z" />
        </svg>
        Pago seguro y cifrado
      </span>
      <PayLogos brands={brands} />
    </div>
  );
}
