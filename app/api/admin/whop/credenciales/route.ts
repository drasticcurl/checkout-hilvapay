/**
 * `/api/admin/whop/credenciales` — leer, probar y rotar las credenciales de Whop.
 *
 * La sesión ya la exige `middleware.ts` (`/api/admin/:path*` está en el matcher),
 * así que acá no se vuelve a chequear la cookie. Lo que sí se pide de nuevo es la
 * **contraseña del panel** para escribir, y no es paranoia decorativa: rotar
 * estas credenciales es la acción de mayor privilegio de todo el panel — una key
 * y un biz id ajenos hacen que los cobros siguientes vayan a OTRA cuenta de Whop.
 * Una cookie robada o una pestaña abierta en una máquina prestada no debería
 * alcanzar para eso.
 *
 *   GET    → estado actual (nunca la key, solo los últimos 4)
 *   POST   → probar un juego de credenciales contra Whop, sin guardar nada
 *   PUT    → probar y, si pasa, guardar (pide contraseña)
 *   DELETE → borrar el override y volver a las variables de entorno (pide contraseña)
 */
import { NextResponse } from 'next/server';
import { passwordCorrecta } from '../../../../../lib/auth';
import { SinClaveDeCifrado } from '../../../../../lib/cripto';
import {
  estadoCredenciales,
  guardarCredenciales,
  resolverCredenciales,
  verificarCredenciales,
  volverAlEntorno,
  type Credenciales,
} from '../../../../../lib/whop-credenciales';

// Sin estas dos, Next prerenderiza el handler en el build y hornea la respuesta
// —incluido el estado de las credenciales— dentro de `.next/`. Y `pg` no corre
// en edge.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Lo que llega del formulario, antes de validar. */
type Entrada = Partial<Credenciales> & { password?: string };

/**
 * Valida la forma de lo que llegó.
 *
 * `apiKey` vacía NO es un error: significa "dejá la que ya está puesta". Sin eso,
 * cambiar solo el company id obligaría a volver a pegar la key entera, y el
 * camino de menor esfuerzo para el operador pasaría a ser tener la key en un
 * archivo de texto en el escritorio. La key actual se resuelve del lado del
 * servidor; el browser nunca la ve.
 */
function leerCredenciales(
  d: Entrada,
  keyActual: string | null,
): { ok: true; creds: Credenciales; keyReusada: boolean } | { ok: false; error: string } {
  const apiKeyPegada = typeof d.apiKey === 'string' ? d.apiKey.trim() : '';
  const companyId = typeof d.companyId === 'string' ? d.companyId.trim() : '';
  const base = typeof d.base === 'string' ? d.base.trim() : '';
  const versionDate = typeof d.versionDate === 'string' ? d.versionDate.trim() : '';

  const apiKey = apiKeyPegada || keyActual || '';
  if (!apiKey) {
    return { ok: false, error: 'Falta la API key y no hay ninguna configurada todavía.' };
  }
  if (!companyId) return { ok: false, error: 'Falta el company id.' };
  if (!base) return { ok: false, error: 'Falta la URL base de la API.' };
  if (!versionDate) return { ok: false, error: 'Falta la fecha de versión de la API.' };

  // Se valida la FORMA acá y el fondo lo valida Whop. Esto es solo para no
  // gastar un round-trip en un dedazo evidente.
  if (!/^biz_[A-Za-z0-9]+$/.test(companyId)) {
    return { ok: false, error: 'El company id tiene que empezar con "biz_". Copialo del dashboard de Whop.' };
  }
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return { ok: false, error: 'La URL base no es una URL válida.' };
  }
  if (url.protocol !== 'https:') {
    // Sin esto, un `http://` mandaría la API key en claro por la red.
    return { ok: false, error: 'La URL base tiene que ser https.' };
  }
  if (!/^\d{4}-\d{2}-\d{2}(-\d+)?$/.test(versionDate)) {
    return { ok: false, error: 'La fecha de versión va como 2026-08-21-1.' };
  }

  return {
    ok: true,
    creds: { apiKey, companyId, base, versionDate },
    keyReusada: !apiKeyPegada,
  };
}

/** La key que está en uso ahora, para poder reusarla si el formulario la dejó vacía. */
async function keyEnUso(): Promise<string | null> {
  try {
    const { credenciales } = await resolverCredenciales();
    return credenciales.apiKey;
  } catch {
    return null;
  }
}

async function cuerpo(req: Request): Promise<Entrada | null> {
  try {
    return (await req.json()) as Entrada;
  } catch {
    return null;
  }
}

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json({ estado: await estadoCredenciales() });
  } catch (err) {
    console.error('[api/admin/whop/credenciales] GET:', err);
    return NextResponse.json({ error: 'error_interno' }, { status: 500 });
  }
}

/** Sonda: prueba contra Whop y no guarda nada. No pide contraseña porque no escribe. */
export async function POST(req: Request): Promise<NextResponse> {
  const d = await cuerpo(req);
  if (!d) return NextResponse.json({ error: 'payload_invalido' }, { status: 400 });

  const parsed = leerCredenciales(d, await keyEnUso());
  if (!parsed.ok) return NextResponse.json({ ok: false, motivo: parsed.error }, { status: 400 });

  const r = await verificarCredenciales(parsed.creds);
  // 200 incluso cuando `ok:false`: el request se procesó bien, lo que falló es la
  // credencial. Un 4xx acá haría que el cliente no pueda distinguir "Whop la
  // rechazó" de "mi request estaba mal formado".
  return NextResponse.json(r);
}

export async function PUT(req: Request): Promise<NextResponse> {
  const d = await cuerpo(req);
  if (!d) return NextResponse.json({ error: 'payload_invalido' }, { status: 400 });

  if (typeof d.password !== 'string' || !(await passwordCorrecta(d.password))) {
    return NextResponse.json({ ok: false, motivo: 'Contraseña incorrecta.' }, { status: 401 });
  }

  const parsed = leerCredenciales(d, await keyEnUso());
  if (!parsed.ok) return NextResponse.json({ ok: false, motivo: parsed.error }, { status: 400 });

  // Verificar SIEMPRE antes de guardar. Es la regla del módulo: una credencial
  // mal pegada no falla al guardarse, falla en el primer cobro real, y ahí ya es
  // una venta perdida en vez de un mensaje de error.
  const v = await verificarCredenciales(parsed.creds);
  if (!v.ok) return NextResponse.json({ ok: false, motivo: v.motivo, status: v.status });

  try {
    await guardarCredenciales(parsed.creds, v.companyNombre);
  } catch (err) {
    if (err instanceof SinClaveDeCifrado) {
      return NextResponse.json(
        {
          ok: false,
          motivo:
            'Falta CONFIG_ENCRYPTION_KEY en el entorno del servidor, así que la key no se puede guardar cifrada. Generá una con `openssl rand -hex 32`, ponela en el .env y reiniciá.',
        },
        { status: 409 },
      );
    }
    console.error('[api/admin/whop/credenciales] PUT:', err);
    return NextResponse.json({ ok: false, motivo: 'No se pudo guardar.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, companyNombre: v.companyNombre, estado: await estadoCredenciales() });
}

export async function DELETE(req: Request): Promise<NextResponse> {
  const d = await cuerpo(req);
  if (!d) return NextResponse.json({ error: 'payload_invalido' }, { status: 400 });

  if (typeof d.password !== 'string' || !(await passwordCorrecta(d.password))) {
    return NextResponse.json({ ok: false, motivo: 'Contraseña incorrecta.' }, { status: 401 });
  }

  try {
    await volverAlEntorno();
  } catch (err) {
    console.error('[api/admin/whop/credenciales] DELETE:', err);
    return NextResponse.json({ ok: false, motivo: 'No se pudo borrar el override.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, estado: await estadoCredenciales() });
}
