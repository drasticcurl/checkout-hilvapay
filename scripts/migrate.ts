/**
 * Runner de migraciones. `npm run db:migrate`.
 *
 * Aplica los .sql de db/migrations/ en orden alfabético y anota cada uno en
 * `_migraciones`. Volver a correrlo no hace nada: es seguro ejecutarlo en cada
 * deploy.
 *
 * OJO CON EL ENV: Next carga `.env.local` solo, pero `tsx` no. Por eso el script
 * de npm lo invoca con `tsx --env-file=.env.local`. Si lo corrés a mano sin ese
 * flag, `DATABASE_URL` va a estar vacía y el error no menciona el archivo.
 *
 * Cada archivo va en su propia transacción. Si el 002 falla, el 001 queda
 * aplicado y anotado, y se puede corregir el 002 y reintentar sin tocar nada
 * más. Postgres soporta DDL transaccional, así que un archivo a medio aplicar
 * no existe: o entra completo o no entra.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Client } from 'pg';

const DIR = join(process.cwd(), 'db', 'migrations');

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL. Poné el valor en .env.local o pasalo inline.');
    process.exit(1);
  }

  // Cliente suelto y no pool: es un script de una sola pasada y así el proceso
  // termina cuando termina, sin conexiones idle colgadas.
  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    await client.query(`
      create table if not exists _migraciones (
        nombre      text primary key,
        hash        text not null,
        aplicada_at timestamptz not null default now()
      )
    `);

    const aplicadas = new Map<string, string>(
      (await client.query<{ nombre: string; hash: string }>('select nombre, hash from _migraciones')).rows.map(
        (r) => [r.nombre, r.hash],
      ),
    );

    const archivos = readdirSync(DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    if (archivos.length === 0) {
      console.log('No hay migraciones en db/migrations/');
      return;
    }

    let nuevas = 0;

    for (const nombre of archivos) {
      const sql = readFileSync(join(DIR, nombre), 'utf8');
      const hash = createHash('sha256').update(sql).digest('hex').slice(0, 16);
      const yaAplicada = aplicadas.get(nombre);

      if (yaAplicada) {
        // Editar una migración ya aplicada es la forma más común de que la base
        // de producción y la de desarrollo queden distintas sin que nadie se dé
        // cuenta. Se avisa fuerte pero no se re-aplica: re-aplicar podría
        // borrar datos.
        if (yaAplicada !== hash) {
          console.warn(
            `⚠  ${nombre} cambió después de aplicarse (${yaAplicada} → ${hash}). ` +
              'La base NO se modificó. Si el cambio hace falta, va en una migración nueva.',
          );
        }
        continue;
      }

      process.stdout.write(`→ ${nombre} ... `);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('insert into _migraciones (nombre, hash) values ($1, $2)', [nombre, hash]);
        await client.query('COMMIT');
        console.log('ok');
        nuevas++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.log('FALLÓ');
        throw err;
      }
    }

    console.log(nuevas === 0 ? 'Nada nuevo que aplicar.' : `${nuevas} migración(es) aplicada(s).`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('\nError aplicando migraciones:', err instanceof Error ? err.message : err);
  process.exit(1);
});
