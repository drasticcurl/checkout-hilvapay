/**
 * `GET /api/admin/productos/revisar-planes` — chequea, contra la API de Whop, que
 * el plan de cada producto pertenezca a la company que cobra.
 *
 * Bajo demanda y no en cada carga de `/admin/productos`: es una llamada a Whop por
 * producto, y es un dato que cambia una vez al año (cuando se rota la cuenta). Ver
 * `lib/admin/planes.ts` para por qué el chequeo es sobre `account.id` y no sobre
 * el status HTTP.
 *
 * Está bajo `/api/admin`, así que el middleware ya exigió la cookie de sesión:
 * llegar acá implica estar logueado.
 */
import { NextResponse } from 'next/server';
import { resolverCredenciales } from '@/lib/whop-credenciales';
import { hayProblemas, revisarPlanesDeProductos } from '@/lib/admin/planes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    const { credenciales, fuente } = await resolverCredenciales();
    const revisados = await revisarPlanesDeProductos(
      credenciales.companyId,
      credenciales.base,
      credenciales.apiKey,
      credenciales.versionDate,
    );

    return NextResponse.json({
      ok: true,
      companyActiva: credenciales.companyId,
      fuenteCredenciales: fuente,
      hayProblemas: hayProblemas(revisados),
      revisados,
    });
  } catch (err) {
    // Sin credenciales resolubles no se puede revisar nada, y eso NO es un 500:
    // es un estado normal de un servicio recién instalado. Se responde 200 con el
    // motivo para que la pantalla lo muestre en vez de romperse.
    console.error('[admin/revisar-planes] no se pudo revisar:', err);
    return NextResponse.json({
      ok: false,
      motivo: err instanceof Error ? err.message : 'No se pudo consultar a Whop.',
    });
  }
}
