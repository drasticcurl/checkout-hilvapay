/**
 * El token público de una orden. Viaja en la URL hacia las páginas de upsell
 * del funnel (`?ot=<token>`, D9 del plan) y es lo que habilita cobrar la
 * tarjeta guardada sin cookies — los dominios son distintos y no se comparten.
 *
 * Por qué NO es un uuid ni `Math.random()`:
 *   - un uuid v4 tiene 122 bits de entropía pero un formato público y
 *     adivinable en su estructura; no hay ganancia en usarlo como secreto.
 *   - `Math.random()` no es criptográficamente seguro: en V8 es predecible
 *     observando suficientes salidas.
 * `randomBytes(32)` da 256 bits, y en base64url no tiene caracteres que haya
 * que escapar en una URL o una query string.
 */
import { randomBytes } from 'node:crypto';
import { q1 } from './db';
import type { Orden } from './tipos';

/** 32 bytes en base64url → 43 caracteres, alfabeto [A-Za-z0-9_-]. */
export function generarToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Busca la orden por token y valida el vencimiento.
 *
 * Devuelve un motivo discriminado en vez de `null`: el endpoint de cobro
 * necesita distinguir "token que nunca existió" de "token vencido" para poder
 * responder 401 con un mensaje que le sirva al comprador ("volvé a empezar la
 * compra") en lugar de un genérico que no dice qué hacer.
 *
 * El input es `unknown` a propósito: viene del body de un POST público, y
 * cualquier cosa que no sea un string razonable tiene que caer en `invalido`
 * sin tirar una excepción ni llegar a tocar la base con un tipo raro.
 */
export async function resolverToken(
  token: unknown,
): Promise<{ ok: true; orden: Orden } | { ok: false; motivo: 'invalido' | 'vencido' }> {
  // Guarda de forma antes de tocar la base. Un token real son 43 caracteres;
  // se acepta un rango generoso para no atarse al largo exacto, pero un string
  // de 10 000 caracteres no debería ni llegar a un SELECT.
  if (typeof token !== 'string' || token.length === 0 || token.length > 512) {
    return { ok: false, motivo: 'invalido' };
  }

  // El token se compara por igualdad en SQL — es la misma comparación que hace
  // el índice único `ordenes_token_idx`. No hace falta tiempo constante: no se
  // está validando un secreto contra otro secreto que el server ya conoce, se
  // está buscando una fila por una clave de 256 bits de entropía. Un atacante
  // que mide microsegundos de diferencia entre "no existe" y "existe pero
  // difiere en el último byte" no gana nada: no hay un segundo secreto que
  // comparar carácter por carácter, solo hay o no hay una fila con esa clave.
  const orden = await q1<Orden>(
    `select id, pagina_id, email, nombre, token, token_expira_at, whop_member_id,
            whop_payment_method_id, whop_user_id, whop_checkout_config_id, whop_payment_method_type,
            metodo_guardado, session_id, visitor_id, utms, created_at, updated_at
       from ordenes
      where token = $1`,
    [token],
  );

  if (!orden) return { ok: false, motivo: 'invalido' };

  if (new Date(orden.token_expira_at).getTime() < Date.now()) {
    return { ok: false, motivo: 'vencido' };
  }

  return { ok: true, orden };
}
