/**
 * Guard del panel. Corre en el runtime edge (Next lo exige para middleware),
 * por eso usa `verificarSesion` de `lib/auth.ts`, que está escrito con
 * `crypto.subtle` y no `node:crypto` (ver el comentario de ese archivo).
 *
 * ── El matcher es una ALLOWLIST, nunca un "todo menos" ──────────────────────
 * Si esto agarrara `/api/webhooks/whop` por accidente, Whop recibiría un 307 en
 * vez de 200, reintentaría, y a las 72 horas deshabilitaría el webhook — sin
 * reenviar los eventos de ese período. Por eso el `matcher` de abajo lista
 * SOLO lo que hay que proteger (`/admin/**` y `/api/admin/**`, con excepción de
 * login) y nada más. Cualquier ruta nueva que no esté en esa lista queda
 * pública por default, que es la dirección segura de este servicio: el
 * checkout y el webhook los usan compradores y Whop, sin cookie.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE_SESION, verificarSesion } from './lib/auth';

function esApi(pathname: string): boolean {
  return pathname.startsWith('/api/');
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  // El login (página y endpoint) tiene que quedar afuera del guard: si no,
  // nadie podría loguearse nunca porque el propio POST de login exigiría la
  // cookie que todavía no existe.
  if (pathname === '/admin/login' || pathname === '/api/admin/login') {
    return NextResponse.next();
  }

  const token = req.cookies.get(COOKIE_SESION)?.value;
  const autenticado = await verificarSesion(token);

  if (autenticado) {
    return NextResponse.next();
  }

  // `/api/admin/**` responde 401 JSON, no un redirect: el cliente hace fetch()
  // y espera .json(), y un 307 al HTML del login rompería ahí con un error que
  // no menciona la sesión.
  if (esApi(pathname)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const login = req.nextUrl.clone();
  login.pathname = '/admin/login';
  login.search = '';
  return NextResponse.redirect(login);
}

export const config = {
  // Lista explícita de lo que SÍ se protege. Todo lo que no está acá —
  // /pagos/**, /api/checkout/**, /api/upsell/**, /api/cobros/**,
  // /api/webhooks/**, /api/cron/**, /loader.js — queda fuera del middleware a
  // propósito: son rutas públicas o con su propia autenticación (firma HMAC,
  // CRON_SECRET), y el comprador anónimo o Whop no llevan esta cookie.
  matcher: ['/admin', '/admin/:path*', '/api/admin', '/api/admin/:path*'],
};
