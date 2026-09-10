/**
 * `GET /api/admin/funnels` — listado con pasos, para `/admin/funnels`.
 * `POST /api/admin/funnels` — alta del editor completo (nombre + pasos + flechas).
 *
 * Protegido por el middleware (`/api/admin/**`): llegar hasta acá ya implica
 * cookie válida.
 */
import { NextResponse } from 'next/server';
import { guardarFunnel, listarFunnelsConPasos, type EntradaFunnel } from '../../../../lib/admin/funnels';

// Estas dos declaraciones no son decorativas. Sin ellas, Next PRERENDERIZA el
// handler durante el build: la respuesta queda congelada en `.next/` para
// siempre. Verificado el 2026-09-10 con `/api/admin/cobros`.
//
// `runtime = 'nodejs'` porque estas rutas usan `pg`, que no corre en edge.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const funnels = await listarFunnelsConPasos();
  return NextResponse.json({ funnels });
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'payload_invalido' }, { status: 400 });
  }

  const d = body as Partial<EntradaFunnel>;
  if (typeof d.nombre !== 'string' || !d.nombre.trim()) {
    return NextResponse.json({ error: 'falta_nombre' }, { status: 400 });
  }
  if (!Array.isArray(d.pasos)) {
    return NextResponse.json({ error: 'faltan_pasos' }, { status: 400 });
  }

  const resultado = await guardarFunnel(null, {
    nombre: d.nombre,
    url_gracias: d.url_gracias ?? null,
    pasos: d.pasos,
  });

  if (!resultado.ok) {
    // 409 para el ciclo y los conflictos de unicidad: es el mismo código que
    // usan paginas/productos para "esto que mandaste choca con algo que ya
    // existe o con una regla del grafo", no un error del servidor.
    const status = resultado.error === 'datos_invalidos' ? 400 : 409;
    return NextResponse.json({ error: resultado.error, detalle: resultado.detalle }, { status });
  }

  return NextResponse.json({ id: resultado.id }, { status: 201 });
}
