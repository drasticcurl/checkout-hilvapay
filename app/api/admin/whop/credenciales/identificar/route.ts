/**
 * `POST /api/admin/whop/credenciales/identificar` — a qué company pertenece una
 * API key.
 *
 * Está separado del endpoint de credenciales a propósito: pega a `v5/company`, una
 * versión distinta de la API que la que usa todo el resto del servicio (v1), y esa
 * mezcla conviene que se vea en la estructura de archivos y no escondida en una
 * rama de un handler que también guarda.
 *
 * No escribe nada, así que no pide la contraseña del panel. La sesión ya la exige
 * el middleware.
 *
 * `apiKey` vacía significa "la que ya está en uso", igual que en el resto de la
 * pantalla: sirve para preguntar "¿de quién es la key que tengo puesta?" sin
 * tenerla a mano.
 */
import { NextResponse } from 'next/server';
import { identificarCompany, resolverCredenciales } from '@/lib/whop-credenciales';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<NextResponse> {
  let d: { apiKey?: string; base?: string };
  try {
    d = (await req.json()) as { apiKey?: string; base?: string };
  } catch {
    return NextResponse.json({ error: 'payload_invalido' }, { status: 400 });
  }

  const pegada = typeof d.apiKey === 'string' ? d.apiKey.trim() : '';
  const basePedida = typeof d.base === 'string' ? d.base.trim() : '';

  let apiKey = pegada;
  let base = basePedida;

  if (!apiKey || !base) {
    // Se completa con lo que está en uso. Envuelto porque puede no haber nada
    // configurado todavía, y en ese caso el mensaje tiene que decir eso y no
    // reventar con un 500.
    try {
      const { credenciales } = await resolverCredenciales();
      apiKey = apiKey || credenciales.apiKey;
      base = base || credenciales.base;
    } catch {
      /* se resuelve abajo con el chequeo de faltantes */
    }
  }

  if (!apiKey) {
    return NextResponse.json(
      { ok: false, motivo: 'Pegá una API key primero: no hay ninguna configurada todavía.' },
      { status: 400 },
    );
  }
  if (!base) {
    return NextResponse.json({ ok: false, motivo: 'Falta la URL base de la API.' }, { status: 400 });
  }

  // 200 incluso con `ok:false`: el request se procesó, lo que falló es la
  // credencial. Un 4xx no dejaría distinguir eso de un payload mal armado.
  return NextResponse.json(await identificarCompany(apiKey, base));
}
