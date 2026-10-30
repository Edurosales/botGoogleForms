/**
 * Logos de los medios de pago (archivos oficiales en public/logosPagos).
 * Cada logo va en una ficha del mismo tamaño y se ajusta adentro sin
 * deformarse, así se ven parejos aunque cada imagen tenga otra proporción.
 * Solo se muestran los medios que de verdad están activos en la tienda.
 */
type Brand = "visa" | "mastercard" | "amex" | "diners" | "mercadopago" | "yape" | "pagoefectivo";

const LOGO: Record<Brand, { name: string; src: string }> = {
  visa: { name: "Visa", src: "/logosPagos/visa.png" },
  mastercard: { name: "Mastercard", src: "/logosPagos/mastercard.png" },
  amex: { name: "American Express", src: "/logosPagos/amex.png" },
  diners: { name: "Diners Club", src: "/logosPagos/diners.png" },
  mercadopago: { name: "Mercado Pago", src: "/logosPagos/mercadoPago.png" },
  yape: { name: "Yape", src: "/logosPagos/yape.png" },
  pagoefectivo: { name: "PagoEfectivo", src: "/logosPagos/pagoEfectivo.png" },
};

export const IZIPAY_BRANDS: Brand[] = ["visa", "mastercard", "amex", "diners"];
export const MP_BRANDS: Brand[] = ["mercadopago", "yape", "pagoefectivo"];

export function PayLogos({ brands, label }: { brands: Brand[]; label?: string }) {
  return (
    <span className="paylogos" role="list" aria-label={label ?? `Acepta: ${brands.map((b) => LOGO[b].name).join(", ")}`}>
      {brands.map((b) => (
        <span key={b} className="paylogo" role="listitem" title={LOGO[b].name}>
          {/* eslint-disable-next-line @next/next/no-img-element -- logos chicos y fijos: no necesitan optimización */}
          <img src={LOGO[b].src} alt={LOGO[b].name} width={56} height={24} loading="lazy" decoding="async" />
        </span>
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
