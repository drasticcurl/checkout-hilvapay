import { Pool } from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';

/**
 * Acceso a Postgres. Mismos helpers que `dashboard-admin/lib/db.ts` (`q`, `q1`,
 * `tx`) para que el código se lea igual entre los dos proyectos.
 *
 * `max: 10` porque esto corre como UN proceso largo de PM2 en la VPS, con Caddy
 * adelante — no como funciones serverless. Un proceso persistente reusa las
 * conexiones del pool entre requests, así que 10 alcanzan de sobra y no hay
 * riesgo de agotar el límite del servidor. (En serverless habría que bajarlo a 2
 * o 3, porque cada invocación concurrente es un proceso nuevo con su propio pool
 * y el límite se multiplica por la concurrencia. No es el caso.)
 *
 * Postgres es el paquete nativo de Ubuntu en `127.0.0.1`, no un contenedor y no
 * un servicio hosteado: no hace falta pooler externo ni SSL.
 *
 * No hay modo degradado: sin base no se puede cobrar, y el error tiene que
 * salir fuerte y temprano en vez de dejar órdenes a medio escribir.
 */
let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL no está configurada: sin base no se puede cobrar');
    }
    pool = new Pool({
      connectionString: url,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    // Sin este listener, un reinicio de Postgres se propaga como excepción no
    // capturada y tumba la función entera en vez de reintentar la conexión.
    pool.on('error', (err) => {
      console.error('[pg] error en el pool (la conexión se reintenta sola):', err.message);
    });
  }
  return pool;
}

/**
 * Query de una sola vez. Los parámetros SIEMPRE van como $1, $2 — nunca
 * interpolados. Este servicio recibe webhooks y un endpoint público de cobro:
 * acá es la única defensa contra inyección SQL.
 */
export async function q<T extends QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]> {
  const res = await getPool().query(sql, params);
  return res.rows as T[];
}

/** Una sola fila o null. */
export async function q1<T extends QueryResultRow>(sql: string, params?: unknown[]): Promise<T | null> {
  const rows = await q<T>(sql, params);
  return rows[0] ?? null;
}

/**
 * Cantidad de filas afectadas. Se usa para leer el resultado de un
 * `ON CONFLICT DO NOTHING`: 0 significa "ya existía", que es cómo se detecta un
 * webhook duplicado sin hacer un SELECT extra.
 */
export async function qCount(sql: string, params?: unknown[]): Promise<number> {
  const res = await getPool().query(sql, params);
  return res.rowCount ?? 0;
}

/**
 * Transacción: BEGIN, callback, COMMIT; ROLLBACK y re-throw si el callback
 * tira. El cliente se libera siempre, también cuando el COMMIT falla.
 */
export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
