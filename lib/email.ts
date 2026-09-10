/**
 * El email de entrega. Se manda cuando un cobro del front queda `pagado`.
 *
 * Por qué esto importa más de lo que parece: la company de Whop tiene
 * `send_customer_emails: false` (verificado contra la API el 2026-09-10), o sea
 * que Whop hoy no le manda NINGÚN email al comprador. Este archivo no es un
 * "más adelante con branding" — mientras eso no cambie, es el único camino de
 * entrega que existe. Si el interruptor está encendido y esto falla en
 * silencio, alguien pagó y no recibió nada.
 *
 * El interruptor en sí vive en la tabla `config` (migración 002), no en un env
 * var: un env var obliga a redeployar justo cuando hace falta frenar un envío
 * que está saliendo mal. Acá solo se LEE ese interruptor; prenderlo es una
 * acción del panel (T02), no de este archivo.
 */
import { Resend } from 'resend';
import { q, q1 } from './db';
import { entregaHtml, entregaTexto } from '../emails/entrega';

let clienteResend: Resend | null | undefined;

/**
 * `undefined` = todavía no se intentó crear. `null` = se intentó y no hay
 * `RESEND_API_KEY`. Evita crear el cliente Resend en cada invocación sin volver
 * a leer el env var en cada llamada tampoco (por si el proceso lo tiene fijo,
 * es una sola lectura).
 */
function getResend(): Resend | null {
  if (clienteResend !== undefined) return clienteResend;
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    clienteResend = null;
    return null;
  }
  clienteResend = new Resend(key);
  return clienteResend;
}

/**
 * Permite inyectar un cliente de prueba desde los tests, sin tocar el env var
 * real y sin que el mock tenga que imitar el módulo entero de `resend`.
 */
export function _resetClienteResendParaTests(cliente?: Resend | null): void {
  clienteResend = cliente;
}

/** Lee el interruptor de la base. Sin fila (no debería pasar: la 002 la inserta) → apagado. */
export async function emailsActivos(): Promise<boolean> {
  const fila = await q1<{ emails_activos: boolean }>('select emails_activos from config where id = 1');
  return fila?.emails_activos ?? false;
}

export type FilaCobroParaEmail = {
  cobroId: string;
  email: string;
  nombre: string | null;
  productoNombre: string;
};

export type ResultadoEmail = { enviado: boolean; motivo?: string };

/**
 * Manda el email de entrega. Nunca tira: el cron tiene que poder drenar la cola
 * y marcar la fila igual si Resend falla, así que cualquier problema vuelve
 * como `{enviado: false, motivo}` en vez de una excepción.
 *
 * Los tres frenos, en orden, y por qué cada uno importa:
 *   1. Interruptor de base apagado → no se llama a Resend. Es el default
 *      seguro con el que nace el módulo (D14).
 *   2. Sin RESEND_API_KEY → no se llama a Resend. Un despliegue sin esa
 *      variable no puede mandar nada, así de simple.
 *   3. `cobros.email_enviado_at` ya seteado → no se llama a Resend. Es lo que
 *      hace que un reintento de la cola (la fila de `salidas` que falló por
 *      otra razón y se reprocesa) no le mande cuatro copias del mismo email a
 *      la misma persona.
 */
export async function mandarEmailDeEntrega(cobro: FilaCobroParaEmail): Promise<ResultadoEmail> {
  if (!(await emailsActivos())) {
    return { enviado: false, motivo: 'apagado' };
  }

  const resend = getResend();
  if (!resend) {
    console.warn('[email] RESEND_API_KEY no configurada: no se manda nada.');
    return { enviado: false, motivo: 'sin_api_key' };
  }

  const yaEnviado = await q1<{ email_enviado_at: Date | null }>(
    'select email_enviado_at from cobros where id = $1',
    [cobro.cobroId],
  );
  if (yaEnviado?.email_enviado_at) {
    return { enviado: false, motivo: 'ya_enviado' };
  }

  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!from) {
    // Mismo criterio que reset-app/lib/email/resend.ts: sin remitente
    // configurado, mejor no mandar nada que mandar con un dominio equivocado.
    console.warn('[email] RESEND_FROM_EMAIL no configurada: no se manda nada.');
    return { enviado: false, motivo: 'sin_remitente' };
  }

  const saludo = cobro.nombre ? `${cobro.nombre}, ` : '';

  try {
    await resend.emails.send({
      from,
      to: cobro.email,
      subject: `${saludo}tu compra de ${cobro.productoNombre} está lista`,
      html: entregaHtml({ nombre: cobro.nombre, productoNombre: cobro.productoNombre }),
      text: entregaTexto({ nombre: cobro.nombre, productoNombre: cobro.productoNombre }),
    });
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    console.error('[email] error mandando con Resend:', motivo);
    return { enviado: false, motivo: `error_resend: ${motivo}` };
  }

  // Se marca DESPUÉS de que Resend confirmó, no antes: si el proceso se cae
  // entre el envío y este UPDATE, el peor caso es un reintento que Resend
  // podría deduplicar por idempotencia de su lado, no un email que nunca se
  // registra como mandado y por eso se reintenta para siempre.
  await q('update cobros set email_enviado_at = now() where id = $1', [cobro.cobroId]);

  return { enviado: true };
}
