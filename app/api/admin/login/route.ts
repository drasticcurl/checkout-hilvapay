/**
 * `POST /api/admin/login` — el único endpoint que el middleware deja pasar sin
 * cookie (es lo que la emite). Devuelve 200 + Set-Cookie si el password es
 * correcto, 401 si no.
 */
import { NextResponse } from 'next/server';
import { COOKIE_SESION, DIAS_SESION, firmarSesion, passwordCorrecta } from '../../../../lib/auth';

// Estas dos declaraciones no son decorativas. Sin ellas, Next PRERENDERIZA el
// handler durante el build: la respuesta queda congelada en `.next/` para
// siempre, y si la query devolvía filas, esos datos quedan escritos en el
// artefacto del build. Verificado el 2026-09-10: `/api/admin/cobros` horneó un
// cobro con el email del comprador adentro, y `/api/admin/productos/planes`
// llamó a la API de Whop en tiempo de build y congeló la lista de planes.
//
// `runtime = 'nodejs'` porque estas rutas usan `pg`, que no corre en edge.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'payload_invalido' }, { status: 400 });
  }

  const password = (body as { password?: unknown })?.password;
  if (typeof password !== 'string') {
    return NextResponse.json({ error: 'payload_invalido' }, { status: 400 });
  }

  const ok = await passwordCorrecta(password);
  if (!ok) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const token = await firmarSesion();
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: COOKIE_SESION,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: DIAS_SESION * 24 * 60 * 60,
  });
  return res;
}
