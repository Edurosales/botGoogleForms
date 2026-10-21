/**
 * Movimientos de saldo SIEMPRE atómicos vía las funciones SQL de
 * schema_web.sql (Ronda 9). Nunca leer-sumar-escribir desde aquí: dos
 * peticiones a la vez (return + IPN de Izipay, dos pestañas) perderían saldo.
 */
import { db } from "./db";

/** Suma créditos comprados (o resta si `amount` es negativo). Devuelve el saldo nuevo. */
export async function addCredits(userId: string, amount: number): Promise<number | null> {
  if (!amount) return null;
  const { data, error } = await db().rpc("web_add_credits", { p_user: userId, p_amount: amount });
  if (error) throw new Error(`No se pudo actualizar el saldo: ${error.message}`);
  return typeof data === "number" ? data : null;
}

/**
 * Descuenta `paid` créditos comprados y `free` de bienvenida, solo si
 * alcanzan ambos. Con valores negativos funciona como reembolso.
 * Devuelve el saldo nuevo, o null si no alcanzó.
 */
export async function spendCredits(
  userId: string,
  paid: number,
  free: number
): Promise<{ credits: number; free_credits: number } | null> {
  const { data, error } = await db().rpc("web_spend_credits", { p_user: userId, p_paid: paid, p_free: free });
  if (error) throw new Error(`No se pudo actualizar el saldo: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row.credits === "number" ? row : null;
}
