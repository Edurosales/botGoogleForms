/**
 * Íconos de línea de la app (sin emojis ni librerías). Trazo de 1.75 en
 * currentColor: toman el color del texto que los rodea.
 */
export type IconName =
  | "tool"
  | "card"
  | "list"
  | "message"
  | "gift"
  | "info"
  | "lock"
  | "check"
  | "star"
  | "refund"
  | "alert"
  | "user";

const PATHS: Record<IconName, string> = {
  tool: "M9 3h6v3H9zM8 4.5H5.5V21h13V4.5H16M9 11h6M9 15h4",
  card: "M3 6.5h18v11H3zM3 10h18M7 14.5h3",
  list: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  message: "M4 5h16v11H9l-5 4z",
  gift: "M4 11h16v9H4zM3 7.5h18V11H3zM12 7.5V20M12 7.5C10.5 4 7 4 7.5 6.5c.3 1 2 1 4.5 1M12 7.5c1.5-3.5 5-3.5 4.5-1-.3 1-2 1-4.5 1",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M12 11v5M12 7.8h.01",
  lock: "M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3",
  check: "M5 12.5l4.2 4.2L19 7",
  star: "M12 4l2.4 5 5.3.7-3.9 3.7 1 5.3L12 16.2 7.2 18.7l1-5.3-3.9-3.7 5.3-.7z",
  refund: "M9 14l-4-4 4-4M5 10h9.5a4.5 4.5 0 0 1 0 9H12",
  alert: "M12 4l9 16H3zM12 10v4.5M12 17.3h.01",
  user: "M12 4a4 4 0 1 0 0 8 4 4 0 1 0 0-8M4.5 20c1-3.6 4-5.5 7.5-5.5s6.5 1.9 7.5 5.5",
};

export default function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
