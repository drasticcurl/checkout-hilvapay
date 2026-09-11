/**
 * IO del tutorial: arma el `SnapshotTutorial` (lib/admin/tutorial.ts) leyendo
 * el estado real de la base y de la config. Separado de la lógica pura a
 * propósito — ver el comentario de cabecera de `tutorial.ts`.
 *
 * Todas las queries reusan lo que ya existía en otras pantallas del panel:
 * este archivo no inventa una forma nueva de contar nada.
 *   · credenciales      → `estadoCredenciales()` de lib/whop-credenciales.ts,
 *                         la misma fuente que pinta /admin/conexion.
 *   · eventos de webhook → `whop_eventos`, la misma tabla que lee `medir()` de
 *                         lib/alertas.ts para la alerta `webhook_mudo`.
 *   · funnels con front+upsell → `listarFunnelsConPasos()` de
 *                         lib/admin/funnels.ts, la misma query de /admin/funnels.
 *   · resto             → conteos directos sobre `productos`, `origenes`,
 *                         `funnels` y `cobros`, todas tablas ya usadas en
 *                         lib/admin/**.
 */
import { q1 } from '../db';
import { estadoCredenciales } from '../whop-credenciales';
import { listarFunnelsConPasos } from './funnels';
import type { SnapshotTutorial } from './tutorial';

export async function tutorialSnapshot(): Promise<SnapshotTutorial> {
  const [credenciales, eventos, productosConPlan, origenesActivos, funnelsActivos, cobrosPagados, funnels] =
    await Promise.all([
      estadoCredenciales(),
      q1<{ total: string }>('select count(*)::text as total from whop_eventos'),
      q1<{ total: string }>(
        `select count(*)::text as total from productos where whop_plan_id is not null and whop_plan_id <> ''`,
      ),
      q1<{ total: string }>('select count(*)::text as total from origenes where activo'),
      q1<{ total: string }>('select count(*)::text as total from funnels where activo'),
      q1<{ total: string }>(`select count(*)::text as total from cobros where status = 'pagado'`),
      listarFunnelsConPasos(),
    ]);

  // "Verificado" y no solo "hay algo configurado": credencialesVerificadas
  // exige haber pasado por `verificarCredenciales()` contra la API real. Con
  // fuente 'base' esa verificación ya ocurrió (guardarCredenciales() la exige
  // antes de escribir). Con fuente 'entorno' no hay ese registro — las env vars
  // pueden estar mal y nadie lo probó — así que ahí se exige el flag adicional
  // `entornoCompleto` como piso mínimo (existen las 4 variables), documentando
  // que es una verificación más débil que la de la base.
  const credencialesVerificadas =
    credenciales.fuente === 'base' ? credenciales.verificadoAt !== null : credenciales.entornoCompleto;

  const hayFunnelConFrontYUpsell = funnels.some(
    (f) => f.pasos.some((p) => p.tipo === 'front') && f.pasos.some((p) => p.tipo === 'upsell'),
  );

  return {
    credencialesVerificadas,
    webhookRecibioAlgunEvento: Number(eventos?.total ?? 0) > 0,
    productosConPlan: Number(productosConPlan?.total ?? 0),
    hayFunnelConFrontYUpsell,
    origenesActivos: Number(origenesActivos?.total ?? 0),
    funnelsActivos: Number(funnelsActivos?.total ?? 0),
    cobrosPagados: Number(cobrosPagados?.total ?? 0),
  };
}
