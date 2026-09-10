/**
 * Vista de solo lectura de los últimos cobros, para diagnosticar una venta
 * puntual desde el panel. No escribe nada — las escrituras de un cobro viven
 * en `lib/cobros.ts` (de T01) y las usan el webhook y el endpoint de cobro.
 */
import { q } from '../db';

/**
 * Una fila de la lista de cobros del panel. Vive acá y no en `lib/tipos.ts`:
 * es una proyección para esta pantalla, no un contrato que otra task consuma
 * (§8 del plan).
 */
export type FilaCobroPanel = {
  id: string;
  status: string;
  monto: string | null;
  moneda: string | null;
  decline_code: string | null;
  whop_payment_id: string | null;
  origen: 'front' | 'upsell';
  created_at: Date;
  /**
   * Un cobro reembolsado o disputado sigue en `status: 'pagado'` — la plata entró
   * y después salió, y son dos hechos distintos.
   *
   * Estas dos columnas se escribían desde el webhook (y ahora también desde la
   * reconciliación) y NO se leían en ninguna pantalla: entraba un contracargo y no
   * se veía en ningún lado del panel. Un chargeback tiene plazo de respuesta, así
   * que "está en la base" no alcanzaba.
   */
  reembolsado_at: Date | null;
  disputa_at: Date | null;
  pagina_slug: string;
  producto_nombre: string;
  orden_email: string | null;
};

/** Últimos N cobros con la orden, la página y el producto resueltos. */
export async function ultimosCobros(limite: number): Promise<FilaCobroPanel[]> {
  return q<FilaCobroPanel>(
    `select c.id, c.status, c.monto, c.moneda, c.decline_code, c.whop_payment_id, c.origen,
            c.created_at, c.reembolsado_at, c.disputa_at,
            pg.slug as pagina_slug, pr.nombre as producto_nombre,
            o.email as orden_email
       from cobros c
       join paginas pg on pg.id = c.pagina_id
       join productos pr on pr.id = c.producto_id
       join ordenes o on o.id = c.orden_id
      order by c.created_at desc
      limit $1`,
    [limite],
  );
}
