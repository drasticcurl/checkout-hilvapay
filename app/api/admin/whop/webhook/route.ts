/**
 * `/api/admin/whop/webhook` — cargar el signing secret del webhook y ver si llega algo.
 *
 * Hermano de `/api/admin/whop/credenciales`, con el mismo criterio de seguridad:
 * la sesión la exige `middleware.ts`, y para escribir se pide la contraseña del
 * panel de nuevo. Con este secret se puede firmar un `payment.succeeded` falso y
 * hacer que el servicio entregue producto sin que nadie haya pagado, así que es
 * una escritura del mismo privilegio que rotar la API key.
 *
 * ── Por qué NO hay una sonda como el POST de credenciales ────────────────────
 * Whop no expone ningún endpoint que valide un signing secret. No hay forma de
 * probarlo desde el servidor. Lo único que lo verifica es que Whop mande un evento
 * real y que la firma valide de este lado: **Dashboard → Developer → Webhooks →
 * Send event**, con `payment.succeeded`.
 *
 * Por eso el GET no devuelve solo "hay secret cargado": devuelve el estado de
 * `whop_eventos`. Que la tabla esté vacía después de un Send event ES el
 * diagnóstico de que el secret no sirve.
 *
 *   GET    → estado del secret (nunca el valor) + eventos recibidos
 *   PUT    → guardar el secret cifrado (pide contraseña)
 *   DELETE → borrar el override y volver a WHOP_WEBHOOK_SECRET (pide contraseña)
 */
import { NextResponse } from 'next/server';
import { passwordCorrecta } from '../../../../../lib/auth';
import { SinClaveDeCifrado } from '../../../../../lib/cripto';
import { estadoWebhook } from '../../../../../lib/admin/webhook-estado';
import {
  borrarWebhookSecret,
  estadoCredenciales,
  formaDeSecretValida,
  guardarWebhookSecret,
} from '../../../../../lib/whop-credenciales';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Entrada = { secret?: string; password?: string };

async function cuerpo(req: Request): Promise<Entrada | null> {
  try {
    return (await req.json()) as Entrada;
  } catch {
    return null;
  }
}

/** La base pública, que es de dónde sale la URL a pegar en Whop. */
function base(): string {
  return process.env.NEXT_PUBLIC_BASE_URL ?? '';
}

async function estadoCompleto() {
  const [creds, webhook] = await Promise.all([estadoCredenciales(), estadoWebhook(base())]);
  return {
    hayWebhookSecret: creds.hayWebhookSecret,
    webhookSecretFuente: creds.webhookSecretFuente,
    webhookSecretAt: creds.webhookSecretAt,
    hayClaveDeCifrado: creds.hayClaveDeCifrado,
    webhook,
  };
}

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json({ estado: await estadoCompleto() });
  } catch (err) {
    console.error('[api/admin/whop/webhook] GET:', err);
    return NextResponse.json({ error: 'error_interno' }, { status: 500 });
  }
}

export async function PUT(req: Request): Promise<NextResponse> {
  const d = await cuerpo(req);
  if (!d) return NextResponse.json({ error: 'payload_invalido' }, { status: 400 });

  if (typeof d.password !== 'string' || !(await passwordCorrecta(d.password))) {
    return NextResponse.json({ ok: false, motivo: 'Contraseña incorrecta.' }, { status: 401 });
  }

  const secret = typeof d.secret === 'string' ? d.secret.trim() : '';
  if (!secret) {
    return NextResponse.json({ ok: false, motivo: 'Pegá el signing secret.' }, { status: 400 });
  }
  // El chequeo de forma ataja los dos errores reales: pegar el secret recodificado
  // en base64 (pierde el prefijo `ws_`) y pegar la API key en el campo equivocado.
  // Ninguno de los dos falla al guardarse: fallan en la primera venta.
  if (!formaDeSecretValida(secret)) {
    return NextResponse.json(
      {
        ok: false,
        motivo:
          'El signing secret de Whop empieza con "ws_". Copialo completo del dashboard, sin recodificarlo en base64.',
      },
      { status: 400 },
    );
  }

  try {
    await guardarWebhookSecret(secret);
  } catch (err) {
    if (err instanceof SinClaveDeCifrado) {
      return NextResponse.json(
        {
          ok: false,
          motivo:
            'Falta CONFIG_ENCRYPTION_KEY en el entorno del servidor, así que el secret no se puede guardar cifrado. Generá una con `openssl rand -hex 32`, ponela en el .env y reiniciá.',
        },
        { status: 409 },
      );
    }
    console.error('[api/admin/whop/webhook] PUT:', err);
    return NextResponse.json({ ok: false, motivo: 'No se pudo guardar.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, estado: await estadoCompleto() });
}

export async function DELETE(req: Request): Promise<NextResponse> {
  const d = await cuerpo(req);
  if (!d) return NextResponse.json({ error: 'payload_invalido' }, { status: 400 });

  if (typeof d.password !== 'string' || !(await passwordCorrecta(d.password))) {
    return NextResponse.json({ ok: false, motivo: 'Contraseña incorrecta.' }, { status: 401 });
  }

  try {
    await borrarWebhookSecret();
  } catch (err) {
    console.error('[api/admin/whop/webhook] DELETE:', err);
    return NextResponse.json({ ok: false, motivo: 'No se pudo borrar el override.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, estado: await estadoCompleto() });
}
