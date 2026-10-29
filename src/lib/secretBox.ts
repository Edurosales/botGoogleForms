/**
 * Cifrado de secretos guardados en la base (claves de IA): AES-256-GCM.
 * La llave sale de AI_KEYS_SECRET si existe; si no, se deriva de
 * SUPABASE_SERVICE_KEY, que ambos proyectos (panel y servicio) ya tienen.
 * Así una copia de la tabla o un log nunca expone las claves en claro.
 * Mismo archivo en license-server/src/lib/secretBox.ts.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key(): Buffer {
  const base = (process.env.AI_KEYS_SECRET || process.env.SUPABASE_SERVICE_KEY || "").trim();
  if (!base) throw new Error("Falta SUPABASE_SERVICE_KEY (o AI_KEYS_SECRET) para cifrar las claves.");
  return createHash("sha256").update(`formsbot-ai-keys:${base}`).digest();
}

/** "v1.<iv>.<tag>.<datos>" en base64url. */
export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function open(sealed: string): string {
  const [v, iv, tag, data] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Formato de clave cifrada no válido.");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}
