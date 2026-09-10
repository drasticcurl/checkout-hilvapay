/**
 * GET /api/health — ¿está sana esta instancia?
 *
 * ── Por qué hacía falta ─────────────────────────────────────────────────────
 * `deploy/deploy.sh` hacía el health check contra `http://127.0.0.1:3020/`, que
 * sirve `app/page.tsx`: una página estática que **responde 200 con Postgres
 * caído, con la WHOP_API_KEY vencida y con las migraciones sin correr**. O sea:
 * el rollback automático del deploy estaba mirando que Node hubiera arrancado, y
 * nada más.
 *
 * Este endpoint chequea lo que de verdad tiene que estar bien para poder cobrar.
 *
 * ── Qué NO hace ─────────────────────────────────────────────────────────────
 * No le pega a la API de Whop. Un health check que depende de un tercero
 * convierte una caída de Whop en un rollback de nuestro deploy, y encima uno que
 * no arregla nada. De Whop solo se verifica que la configuración ESTÉ, no que
 * responda.
 *
 * ── Qué expone y a quién ────────────────────────────────────────────────────
 * Público: `{ok, servicio, base, migraciones}`. Sin versiones, sin hostnames, sin
 * nombres de variables faltantes.
 *
 * Con `Authorization: Bearer $CRON_SECRET`: el detalle completo, incluido QUÉ
 * variable falta. Ese detalle es un mapa de la configuración del servicio, así
 * que no va en una respuesta pública — pero es exactamente lo que hace falta
 * cuando el deploy falla y hay que saber por qué en un comando.
 *
 * **Nunca imprime el VALOR de una variable**, en ninguno de los dos modos. Solo
 * si está presente o no.
 *
 * Queda fuera del `matcher` de `middleware.ts`, así que se sirve en cualquier
 * host y sin sesión — igual que el webhook y los crons.
 */
import { NextResponse } from 'next/server';
import { q1 } from '@/lib/db';
import { cronAutorizado } from '@/lib/cron';
import { pendientesDeReconciliar } from '@/lib/reconciliacion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Las migraciones que tienen que estar aplicadas. Se compara contra la tabla
 * `_migraciones` que escribe `scripts/migrate.ts` (con guion bajo adelante).
 *
 * Es una lista literal y no un `count(*) >= 4`: así el health check detecta el
 * caso real que rompió el primer deploy —el build corriendo antes de la
 * migración— y también el caso de una release nueva cuyo código pide una tabla
 * que en esa base todavía no existe.
 *
 * Sí, hay que agregar una línea acá con cada migración nueva. Es a propósito: es
 * el único lugar donde el código declara qué esquema espera, y olvidarse hace que
 * el health check quede permisivo, no que rompa.
 */
const MIGRACIONES_ESPERADAS = [
  '001_init.sql',
  '002_config_email.sql',
  '003_funnels.sql',
  '004_alertas.sql',
];

/**
 * Lo que sin esto no se puede cobrar, en cualquier entorno.
 *
 * **La UNIÓN de esta lista con `ENV_CRITICAS_PRODUCCION` es la MISMA que
 * `REQUIRED` en `deploy/deploy.sh`, y tiene que seguir siéndolo.** Si el health
 * check fuera más estricto, el deploy pasaría su propio guard, arrancaría, y
 * después este endpoint lo revertiría por una variable que ese guard decidió no
 * exigir — un rollback en loop por una diferencia de criterio entre dos archivos.
 *
 * Ojo con `WHOP_WEBHOOK_SECRET`, que NO está acá y parece que debería: sin ella
 * el webhook rechaza todo con 400, que es el fallo seguro (Whop reintenta y no se
 * pierde nada), y además la reconciliación cierra los cobros igual sin webhook.
 * Es una degradación, no una razón para tumbar un deploy. Está en las opcionales
 * y sale en el detalle.
 */
const ENV_CRITICAS_SIEMPRE = [
  'DATABASE_URL',
  'WHOP_API_KEY',
  'WHOP_COMPANY_ID',
  'WHOP_API_BASE',
  'WHOP_API_VERSION_DATE',
  'PANEL_PASSWORD',
  'NEXT_PUBLIC_BASE_URL',
  'CRON_SECRET',
];

/**
 * Críticas SOLO en producción.
 *
 * En desarrollo los dos dominios son el mismo `localhost` y `middleware.ts`
 * saltea el chequeo de host entero (`esLocal()`), así que exigirlas en local haría
 * que `npm run dev` reporte 503 por algo que no afecta nada. Un health check que
 * da rojo en un entorno sano es un health check que alguien va a aflojar.
 *
 * En producción sí importan: con las dos vacías, el guard del middleware "no
 * bloquea nada" y el panel queda accesible en `pay.hilvanapp.com`, que es el
 * dominio que va en los anuncios.
 */
const ENV_CRITICAS_PRODUCCION = ['PANEL_HOST', 'PAGOS_HOST'];

/**
 * Lo que degrada el servicio pero no impide cobrar. Sale solo en el detalle, y
 * no baja el `ok` ni dispara el rollback.
 *
 *   · sin `WHOP_WEBHOOK_SECRET` → el webhook rechaza todo con 400 (Whop
 *     reintenta); la reconciliación cierra los cobros igual, 10 minutos más tarde
 *   · sin `RESEND_API_KEY` → no sale el email de entrega
 *   · sin `TELEGRAM_BOT_TOKEN` → el vigilante detecta y no puede avisar
 *   · sin `PANEL_INGEST_URL/KEY` → la venta no llega al dashboard-admin (P-04)
 */
const ENV_OPCIONALES = [
  'WHOP_WEBHOOK_SECRET',
  'RESEND_API_KEY',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID_ADMIN',
  'PANEL_INGEST_URL',
  'PANEL_INGEST_KEY',
];

type Chequeo = { ok: boolean; detalle?: string };

async function chequearBase(): Promise<Chequeo & { latenciaMs: number }> {
  const t0 = Date.now();
  try {
    await q1<{ uno: number }>('select 1 as uno');
    return { ok: true, latenciaMs: Date.now() - t0 };
  } catch (err) {
    return {
      ok: false,
      // El mensaje de `pg` puede traer el host y el usuario. Se recorta y solo
      // se muestra en modo detalle.
      detalle: (err instanceof Error ? err.message : String(err)).slice(0, 200),
      latenciaMs: Date.now() - t0,
    };
  }
}

async function chequearMigraciones(): Promise<Chequeo & { faltan: string[] }> {
  try {
    const filas = await q1<{ nombres: string[] }>(
      'select coalesce(array_agg(nombre), array[]::text[]) as nombres from _migraciones',
    );
    const aplicadas = new Set(filas?.nombres ?? []);
    const faltan = MIGRACIONES_ESPERADAS.filter((m) => !aplicadas.has(m));
    return { ok: faltan.length === 0, faltan };
  } catch (err) {
    // La tabla `_migraciones` no existe: la base está vacía. Es el caso exacto
    // del primer deploy, donde el build abortó con `relation "productos" does not
    // exist`.
    return {
      ok: false,
      faltan: MIGRACIONES_ESPERADAS,
      detalle: (err instanceof Error ? err.message : String(err)).slice(0, 200),
    };
  }
}

function chequearEnv(): { ok: boolean; faltan: string[]; faltanOpcionales: string[] } {
  const criticas =
    process.env.NODE_ENV === 'production'
      ? [...ENV_CRITICAS_SIEMPRE, ...ENV_CRITICAS_PRODUCCION]
      : ENV_CRITICAS_SIEMPRE;

  const faltan = criticas.filter((k) => !process.env[k]?.trim());
  const faltanOpcionales = ENV_OPCIONALES.filter((k) => !process.env[k]?.trim());
  return { ok: faltan.length === 0, faltan, faltanOpcionales };
}

export async function GET(req: Request): Promise<Response> {
  const conDetalle = cronAutorizado(req);

  const base = await chequearBase();
  // Las migraciones y los pendientes solo tienen sentido si la base contesta.
  const migraciones = base.ok ? await chequearMigraciones() : { ok: false, faltan: MIGRACIONES_ESPERADAS };
  const env = chequearEnv();

  let pendientes: number | null = null;
  if (base.ok && migraciones.ok) {
    pendientes = await pendientesDeReconciliar().catch(() => null);
  }

  const ok = base.ok && migraciones.ok && env.ok;

  const publico = {
    ok,
    servicio: 'hilvapay',
    base: base.ok ? 'ok' : 'caida',
    migraciones: migraciones.ok ? 'ok' : 'faltan',
    // La configuración se reporta como un booleano en el modo público: que falte
    // una variable es información útil para el que deploya y ruido para
    // cualquier otro.
    config: env.ok ? 'ok' : 'incompleta',
  };

  const cuerpo = conDetalle
    ? {
        ...publico,
        detalle: {
          baseLatenciaMs: base.latenciaMs,
          baseError: base.ok ? null : base.detalle,
          migracionesFaltantes: migraciones.faltan,
          envFaltantes: env.faltan,
          envOpcionalesFaltantes: env.faltanOpcionales,
          cobrosEsperandoReconciliacion: pendientes,
          alertasPorTelegram: process.env.TELEGRAM_BOT_TOKEN?.trim() ? 'configurado' : 'sin configurar',
        },
      }
    : publico;

  // 503 y no 500: es "no estoy en condiciones de atender", que es lo que un
  // health check tiene que poder decir. `deploy.sh` mira el código HTTP, así que
  // esto es lo que dispara el rollback.
  return NextResponse.json(cuerpo, {
    status: ok ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  });
}
