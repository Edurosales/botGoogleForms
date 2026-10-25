/**
 * Motivos de rechazo de Mercado Pago (status_detail) explicados al cliente,
 * con qué hacer. Los que no estén aquí usan el mensaje genérico.
 */
export const MP_REJECT_REASONS: Record<string, string> = {
  cc_rejected_high_risk:
    "Mercado Pago lo rechazó por su sistema antifraude. Prueba con otro medio dentro de Mercado Pago (Yape, saldo o PagoEfectivo) u otra tarjeta, o paga con tarjeta por Izipay si está disponible.",
  cc_rejected_insufficient_amount: "Tu tarjeta no tiene fondos suficientes. Prueba con otra tarjeta o medio de pago.",
  cc_rejected_bad_filled_security_code: "El código de seguridad (CVV) no es correcto. Revísalo e inténtalo de nuevo.",
  cc_rejected_bad_filled_date: "La fecha de vencimiento no es correcta. Revísala e inténtalo de nuevo.",
  cc_rejected_bad_filled_card_number: "El número de tarjeta no es correcto. Revísalo e inténtalo de nuevo.",
  cc_rejected_bad_filled_other: "Algún dato de la tarjeta no es correcto. Revísalos e inténtalo de nuevo.",
  cc_rejected_call_for_authorize: "Tu banco pide que autorices este pago. Llama a tu banco o actívalo en su app y vuelve a intentarlo.",
  cc_rejected_card_disabled: "Tu tarjeta no está habilitada para compras por internet. Actívala con tu banco o usa otra.",
  cc_rejected_duplicated_payment: "Ya hiciste un pago igual hace un momento. Revisa tu correo o Mi cuenta antes de pagar otra vez.",
  cc_rejected_max_attempts: "Superaste los intentos permitidos con esa tarjeta. Usa otra tarjeta u otro medio.",
  cc_rejected_blacklist: "Ese medio de pago no se puede usar. Prueba con otro.",
  cc_rejected_card_error: "No se pudo procesar la tarjeta. Prueba con otra o con otro medio.",
  cc_rejected_other_reason: "Tu banco rechazó el pago sin dar motivo. Prueba con otra tarjeta o con Yape/saldo de Mercado Pago.",
  rejected_by_bank: "Tu banco rechazó el pago. Prueba con otra tarjeta o medio de pago.",
  rejected_by_regulations: "El pago no cumple una regla de Mercado Pago. Prueba con otro medio de pago.",
  rejected_insufficient_data: "Faltan datos para procesar el pago. Completa todos los datos e inténtalo otra vez.",
  pago_de_prueba:
    "Mercado Pago aprobó un pago de PRUEBA, pero la tienda está en modo real y no lo acepta. No uses cuentas ni tarjetas de prueba con credenciales de producción.",
  validacion: "El pago se aprobó pero no coincidió con tu pedido (monto o moneda). Escríbenos a soporte con tu número de pedido.",
};
