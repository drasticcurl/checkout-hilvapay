/**
 * Guard del panel y separación de dominios. Corre en el runtime edge (Next lo
 * exige para middleware), por eso usa `verificarSesion` de `lib/auth.ts`, que
 * está escrito con `crypto.subtle` y no `node:crypto`.
 *
 * ── Dos dominios, un proceso ────────────────────────────────────────────────
 *   hilvapay.hilvanapp.com  → el panel (/admin, /api/admin)
 *   pay.hilvanapp.com       → los links de pago (/pagos, /api/checkout,
 *                             /api/upsell, /api/cobros, /loader.js)
 *
 * Es la misma app de Next detrás del mismo PM2; Caddy proxea los dos hosts al
 * mismo puerto. La separación se hace acá, y **responde 404, no 403**: un 403 en
 * `pay.hilvanapp.com/admin` le confirmaría a un curioso que el panel existe y lo
 * mandaría a buscar en qué otro subdominio está. Un 404 no dice nada.
 *
 * El dominio de pago es el que va a estar en anuncios y en links compartidos:
 * que no exponga ni la pantalla de login.
 *
 * ── El matcher es una ALLOWLIST, nunca un "todo menos" ──────────────────────
 * Si esto agarrara `/api/webhooks/whop` para pedirle cookie, Whop recibiría un
 * 307 en vez de 200, reintentaría, y a las 72 horas deshabilitaría el webhook —
 * sin reenviar los eventos de ese período. El matcher de abajo lista solo lo que
 * necesita middleware; el webhook y el cron entran en la lista para el chequeo de
 * host, pero NUNCA para el de sesión.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE_SESION, verificarSesion } from './lib/auth';

/** Prefijos que solo se sirven en el host del panel. */
const SOLO_PANEL = ['/admin', '/api/admin'];

/** Prefijos que solo se sirven en el host de pagos. */
const SOLO_PAGOS = ['/pagos', '/api/checkout', '/api/upsell', '/api/cobros', '/loader.js'];

/**
 * Rutas que se sirven en CUALQUIER host, a propósito:
 *
 *  - `/api/webhooks/whop`: la URL la configura Whop y se autentica con firma
 *    HMAC. Si el host no coincidiera con lo esperado, el webhook moriría en
 *    silencio y los eventos de ese período no se reenvían nunca.
 *  - `/api/cron/*`: lo llama el cron de la VPS, normalmente contra
 *    `127.0.0.1:<puerto>` sin pasar por Caddy — con lo cual el Host es la IP y no
 *    un dominio. Se autentica con `CRON_SECRET`.
 */
const CUALQUIER_HOST = ['/api/webhooks', '/api/cron'];

function empiezaCon(pathname: string, prefijos: string[]): boolean {
  return prefijos.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * El host real del visitante.
 *
 * `x-forwarded-host` primero porque Caddy termina el TLS y proxea a
 * `127.0.0.1:<puerto>`: el `host` que ve Next es el del proxy, no el que pidió el
 * browser. Es el mismo problema que documenta `dashboard-admin/middleware.ts` en
 * `urlDeLogin`.
 *
 * Los dos headers los puede escribir quien llegue sin pasar por el proxy, así que
 * esto NO es un control de seguridad: es enrutamiento. Lo que protege de verdad
 * el panel es la cookie firmada, y el cobro, la allowlist de `origenes`.
 */
function hostDe(req: NextRequest): string {
  const h = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '';
  return h.split(',')[0].trim().split(':')[0].toLowerCase();
}

function esLocal(host: string): boolean {
  // En desarrollo los dos dominios son el mismo `localhost`, así que el chequeo
  // se saltea entero. Sin esto no se podría abrir el panel en local.
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local');
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  const host = hostDe(req);

  // ── 1. Separación de dominios ──────────────────────────────────────────────
  if (!esLocal(host) && !empiezaCon(pathname, CUALQUIER_HOST)) {
    const hostPanel = (process.env.PANEL_HOST ?? '').toLowerCase();
    const hostPagos = (process.env.PAGOS_HOST ?? '').toLowerCase();

    // La raíz del dominio del panel lleva al panel. Sin esto, entrar a
    // hilvapay.hilvanapp.com muestra el "Nada por acá" de app/page.tsx: correcto
    // para el dominio de pagos, desconcertante para el del panel — el que entra
    // ahí viene a administrar, no a comprar.
    //
    // En el dominio de PAGOS la raíz sigue mostrando "Nada por acá" a propósito:
    // es el host que va en anuncios y en links compartidos por WhatsApp, y no
    // tiene por qué insinuar que existe un panel en algún lado.
    //
    // El health check del deploy no se rompe con esto: pega a 127.0.0.1:3020/,
    // donde el host es una IP y `esLocal()` saltea todo este bloque antes de
    // llegar acá. Verificado después de deployar.
    if (hostPanel && host === hostPanel && pathname === '/') {
      const admin = req.nextUrl.clone();
      admin.pathname = '/admin';
      admin.search = '';
      return NextResponse.redirect(admin);
    }

    // Si no están configurados, no se bloquea nada: un deploy al que le falta una
    // env var tiene que quedar accesible para poder arreglarlo, no tapiado.
    if (hostPanel && empiezaCon(pathname, SOLO_PANEL) && host !== hostPanel) {
      return new NextResponse('Not found', { status: 404 });
    }
    if (hostPagos && empiezaCon(pathname, SOLO_PAGOS) && host !== hostPagos) {
      return new NextResponse('Not found', { status: 404 });
    }
  }

  // ── 2. Sesión, solo para el panel ──────────────────────────────────────────
  if (!empiezaCon(pathname, SOLO_PANEL)) {
    return NextResponse.next();
  }

  // El login (página y endpoint) queda afuera del guard: si no, nadie podría
  // loguearse nunca, porque el propio POST de login exigiría la cookie que
  // todavía no existe.
  if (pathname === '/admin/login' || pathname === '/api/admin/login') {
    return NextResponse.next();
  }

  if (await verificarSesion(req.cookies.get(COOKIE_SESION)?.value)) {
    return NextResponse.next();
  }

  // `/api/admin/**` responde 401 JSON, no un redirect: el cliente hace fetch()
  // y espera .json(), y un 307 al HTML del login rompería ahí con un error que
  // no menciona la sesión.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const login = req.nextUrl.clone();
  login.pathname = '/admin/login';
  login.search = '';
  return NextResponse.redirect(login);
}

export const config = {
  /**
   * Lista explícita. Incluye las rutas públicas de pago porque el middleware
   * también decide el host, pero para ellas NUNCA se pide cookie (ver el paso 2:
   * sale por `NextResponse.next()` antes de mirar la sesión).
   *
   * `/api/webhooks` y `/api/cron` quedan FUERA del matcher por completo: no
   * necesitan ni chequeo de host ni de sesión, y cuanto menos código corra antes
   * del handler del webhook, menos formas hay de romperlo.
   */
  matcher: [
    // La raíz entra al matcher solo para el redirect del dominio del panel. En
    // el dominio de pagos sale por `NextResponse.next()` y sirve app/page.tsx.
    '/',
    '/admin',
    '/admin/:path*',
    '/api/admin',
    '/api/admin/:path*',
    '/pagos/:path*',
    '/api/checkout/:path*',
    '/api/upsell/:path*',
    '/api/cobros/:path*',
    '/loader.js',
  ],
};
