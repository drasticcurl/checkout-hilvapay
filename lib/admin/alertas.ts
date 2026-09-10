/**
 * Queries de `destinatarios_alerta` y `alertas`, para la pantalla del panel.
 *
 * Los destinatarios son a quién le suena el teléfono cuando algo se rompe. La
 * pantalla existe para poder contestar dos preguntas que hoy no se pueden
 * contestar en ningún lado: quién está recibiendo, y si de verdad le está
 * llegando (que no es lo mismo — alguien puede haber bloqueado el bot).
 */
import { q, q1 } from '../db';

export type Destinatario = {
  id: string;
  nombre: string | null;
  chat_id: string;
  activo: boolean;
  ultimo_ok_at: Date | null;
  ultimo_error: string | null;
  created_at: Date;
};

/** Una fila del registro de alertas mandadas. */
export type AlertaRegistrada = {
  clave: string;
  primer_envio_at: Date;
  ultimo_envio_at: Date;
  veces: number;
  ultimo_detalle: string | null;
};

const COLS = `id, nombre, chat_id, activo, ultimo_ok_at, ultimo_error, created_at`;

export async function listarDestinatarios(): Promise<Destinatario[]> {
  return q<Destinatario>(`select ${COLS} from destinatarios_alerta order by created_at asc`);
}

/**
 * Los ids de chat de Telegram son enteros y pueden ser NEGATIVOS: los de grupo y
 * canal empiezan con `-` (los de canal, con `-100`). Una validación que solo
 * acepte dígitos rompe el caso "avisar a un grupo del equipo", que es
 * probablemente el más útil.
 *
 * Se valida acá y no en el endpoint porque el alta también entra por el bot.
 */
export function chatIdValido(valor: string): boolean {
  return /^-?\d{1,20}$/.test(valor.trim());
}

export type EntradaDestinatario = { chatId: string; nombre?: string | null };

/**
 * Alta de un destinatario. A diferencia del resto del módulo, nace ACTIVO:
 * un destinatario apagado no cobra nada ni le muestra nada a nadie, solo deja de
 * recibir avisos. Acá el estado peligroso es el silencio, así que el default se
 * invierte.
 *
 * El upsert reactiva a alguien que se había dado de baja en vez de fallar contra
 * el índice único, que es lo que espera quien lo vuelve a agregar desde el panel.
 */
export async function crearDestinatario(datos: EntradaDestinatario): Promise<Destinatario> {
  const fila = await q1<Destinatario>(
    `insert into destinatarios_alerta (chat_id, nombre, activo)
     values ($1, $2, true)
     on conflict (chat_id) do update
        set activo = true,
            nombre = coalesce(excluded.nombre, destinatarios_alerta.nombre),
            ultimo_error = null
     returning ${COLS}`,
    [datos.chatId.trim(), datos.nombre?.trim() || null],
  );
  return fila!;
}

export async function setActivoDestinatario(id: string, activo: boolean): Promise<void> {
  await q('update destinatarios_alerta set activo = $1 where id = $2', [activo, id]);
}

export async function eliminarDestinatario(id: string): Promise<void> {
  await q('delete from destinatarios_alerta where id = $1', [id]);
}

/** Las últimas alertas mandadas. Es el historial de qué se rompió y cuándo. */
export async function ultimasAlertas(limite: number): Promise<AlertaRegistrada[]> {
  return q<AlertaRegistrada>(
    `select clave, primer_envio_at, ultimo_envio_at, veces, ultimo_detalle
       from alertas
      order by ultimo_envio_at desc
      limit $1`,
    [limite],
  );
}
