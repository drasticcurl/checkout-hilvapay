/**
 * Seed idempotente: los cuatro productos (front + 3 upsells) y sus cuatro
 * links de pago. `ON CONFLICT DO NOTHING` por la clave natural de cada tabla
 * (`whop_plan_id` en productos, `slug` en páginas), así que correrlo dos veces
 * no duplica nada.
 *
 * Precios (P-06 del plan): el front es $9.90 (verificado contra la API real,
 * plan_hgNXAvG16M9ix) y el upsell 3 es $17 (config-latam.ts de testfunnel). Los
 * upsells 1 y 2 quedan en 0.00 con `plan_id` de placeholder: sus planes de Whop
 * todavía no existen (P-02 del plan) y hay que cargarlos desde el panel en
 * cuanto se creen.
 *
 * Todo nace inactivo (D14): ni los productos ni las páginas se activan acá.
 */
import { q } from '../lib/db';

type ProductoSeed = {
  nombre: string;
  whop_plan_id: string;
  precio: string;
  slug: string;
  tipo: 'front' | 'upsell';
  nota?: string;
};

const PRODUCTOS: ProductoSeed[] = [
  {
    nombre: 'Chau Hinchazón - 7 días - Programa con agua de arroz',
    whop_plan_id: 'plan_hgNXAvG16M9ix',
    precio: '9.90',
    slug: 'agua-de-arroz',
    tipo: 'front',
  },
  {
    nombre: 'Upsell 1 (pendiente de precio y plan)',
    whop_plan_id: 'plan_PENDIENTE_1',
    precio: '0.00',
    slug: 'agua-de-arroz-upsell-1',
    tipo: 'upsell',
    nota: 'P-02/P-06 del plan: plan_id y precio reales todavía no existen. Cargar desde el panel.',
  },
  {
    nombre: 'Upsell 2 (pendiente de precio y plan)',
    whop_plan_id: 'plan_PENDIENTE_2',
    precio: '0.00',
    slug: 'agua-de-arroz-upsell-2',
    tipo: 'upsell',
    nota: 'P-02/P-06 del plan: plan_id y precio reales todavía no existen. Cargar desde el panel.',
  },
  {
    nombre: 'Upsell 3',
    whop_plan_id: 'plan_PENDIENTE_3',
    precio: '17.00',
    slug: 'agua-de-arroz-upsell-3',
    tipo: 'upsell',
    nota: 'P-02 del plan: precio confirmado ($17, config-latam.ts), falta el plan_id real de Whop.',
  },
];

async function main(): Promise<void> {
  for (const p of PRODUCTOS) {
    if (p.nota) console.log(`[seed] ${p.slug}: ${p.nota}`);

    const [producto] = await q<{ id: string }>(
      `insert into productos (nombre, whop_plan_id, precio, moneda, activo)
       values ($1, $2, $3, 'usd', false)
       on conflict (whop_plan_id) do nothing
       returning id`,
      [p.nombre, p.whop_plan_id, p.precio],
    );

    // Si el conflicto suprimió el insert, el producto ya existe: hay que
    // buscarlo para poder crear la página igual (el seed es idempotente en las
    // dos tablas, no solo en la primera).
    const productoId =
      producto?.id ??
      (await q<{ id: string }>(`select id from productos where whop_plan_id = $1`, [p.whop_plan_id]))[0]
        ?.id;

    if (!productoId) {
      console.error(`[seed] no se pudo resolver el producto para ${p.whop_plan_id}, se salta la página`);
      continue;
    }

    await q(
      `insert into paginas (slug, producto_id, tipo, activo)
       values ($1, $2, $3, false)
       on conflict (slug) do nothing`,
      [p.slug, productoId, p.tipo],
    );
  }

  console.log('[seed] listo.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed] error:', err);
    process.exit(1);
  });
