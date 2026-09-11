/**
 * Detecta productos cuyo `whop_plan_id` NO pertenece a la company que cobra.
 *
 * ── Por qué hace falta ──────────────────────────────────────────────────────
 * La cuenta de Whop se puede rotar desde `/admin/conexion` sin tocar código: se
 * pega una key nueva y `resolverCredenciales` empieza a usar esa. Lo que NO se
 * mueve con ella son los `whop_plan_id` de `productos`, que siguen apuntando a
 * planes de la cuenta anterior.
 *
 * Y el modo de falla es de los peores que hay. Medido el 2026-09-11 en
 * producción, después de rotar de `biz_Me8Lbiv174brtM` a `biz_LHktpJ17c83CFt`:
 * dos de los cuatro productos seguían apuntando a planes de la company vieja. El
 * panel los mostraba idénticos a los buenos. `GET /plans/{id}` devuelve **200**
 * para un plan de otra company, así que nada en la pantalla delataba el problema
 * — pero cobrar con ellos falla, y falla con el 400 genérico de Whop
 * ("We could not process this payment request right now"), que no dice ni una
 * palabra de companies. Diagnosticarlo llevó una hora.
 *
 * De eso sale la regla de este módulo: **comparar el `account.id` que devuelve el
 * plan contra la company activa**, que es lo único que distingue un plan usable de
 * uno que va a fallar. El status HTTP no sirve para eso.
 *
 * ── Por qué es bajo demanda y no en cada carga ───────────────────────────────
 * Es una llamada a la API de Whop por producto. Con veinte productos, hacerlo en
 * cada visita a `/admin/productos` son veinte round-trips antes de pintar la
 * pantalla, para un dato que cambia una vez al año. Va detrás de un botón.
 */
import { q } from '../db';

/** El veredicto de un plan. */
export type EstadoPlan =
  /** El plan existe y es de la company que cobra. Se puede usar. */
  | 'coincide'
  /** El plan existe pero es de OTRA company. Cobrar con él falla con un 400 opaco. */
  | 'otra_company'
  /** Whop no lo encuentra: se borró, o el id está mal escrito. */
  | 'no_existe'
  /** No se pudo consultar (red, timeout, 5xx de Whop). No se afirma nada. */
  | 'indeterminado';

export type PlanRevisado = {
  productoId: string;
  productoNombre: string;
  whopPlanId: string;
  estado: EstadoPlan;
  /** La company dueña del plan, cuando Whop la devuelve. */
  companyDelPlan: string | null;
  /** El precio según Whop, para cruzarlo con el de la base. */
  precioWhop: string | null;
  /** El precio de `productos.precio`, para poder mostrar el desfasaje. */
  precioLocal: string;
  /** Solo para `indeterminado`: qué pasó. */
  detalle: string | null;
};

/**
 * Clasifica un plan a partir de lo que devolvió Whop. Pura y exportada para
 * poder probar los cuatro casos sin red.
 *
 * `companyEsperada` va primero en la firma porque es el dato contra el que se
 * compara todo lo demás: sin él no hay veredicto posible, y un default sería una
 * invitación a llamarlo sin company y creerle el 'coincide'.
 */
export function clasificarPlan(
  companyEsperada: string,
  status: number,
  companyDelPlan: string | null,
): { estado: EstadoPlan; detalle: string | null } {
  if (status === 404) return { estado: 'no_existe', detalle: null };

  // 401/403 no son "el plan está mal": son "no pudimos preguntar". Marcarlos como
  // error del plan mandaría a alguien a cambiar un `whop_plan_id` que está bien
  // porque la key perdió un permiso.
  if (status === 401 || status === 403) {
    return { estado: 'indeterminado', detalle: `Whop respondió ${status}: la key no pudo consultar el plan.` };
  }
  if (status !== 200) {
    return { estado: 'indeterminado', detalle: `Whop respondió ${status}.` };
  }

  // 200 sin `account.id` en la respuesta: la forma cambió o el plan es raro. No se
  // asume que coincide — asumir que está bien es el error que este módulo existe
  // para evitar.
  if (!companyDelPlan) {
    return { estado: 'indeterminado', detalle: 'Whop devolvió el plan sin la company dueña.' };
  }

  if (companyDelPlan !== companyEsperada) return { estado: 'otra_company', detalle: null };
  return { estado: 'coincide', detalle: null };
}

/** true si hay al menos un producto que no va a poder cobrar. */
export function hayProblemas(revisados: PlanRevisado[]): boolean {
  return revisados.some((r) => r.estado === 'otra_company' || r.estado === 'no_existe');
}

/**
 * El precio de Whop viene como número (`initial_price: 2.0`) y el de la base como
 * string de `numeric(10,2)` ('2.00'). Se comparan como números con dos decimales
 * para no reportar un desfasaje que no existe entre '2.00' y 2.
 *
 * Un desfasaje de precio NO es un error de configuración —se puede querer
 * mostrar un precio y cobrar otro— pero casi siempre es un descuido, así que se
 * informa sin marcarlo como problema.
 */
export function precioDesfasado(precioLocal: string, precioWhop: string | null): boolean {
  if (precioWhop === null) return false;
  const a = Number(precioLocal);
  const b = Number(precioWhop);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return a.toFixed(2) !== b.toFixed(2);
}

type FilaProducto = { id: string; nombre: string; whop_plan_id: string; precio: string };

/**
 * Revisa todos los productos contra la API de Whop.
 *
 * Las consultas van en paralelo con `Promise.all`: son independientes entre sí y
 * en serie la pantalla tardaría la suma de todas. Ninguna puede tumbar al resto —
 * un fallo se convierte en `indeterminado` para ese producto y los demás siguen.
 */
export async function revisarPlanesDeProductos(
  companyEsperada: string,
  base: string,
  apiKey: string,
  versionDate: string,
): Promise<PlanRevisado[]> {
  const productos = await q<FilaProducto>(
    `select id, nombre, whop_plan_id, precio from productos order by created_at`,
  );

  return Promise.all(
    productos.map(async (p): Promise<PlanRevisado> => {
      const comun = {
        productoId: p.id,
        productoNombre: p.nombre,
        whopPlanId: p.whop_plan_id,
        precioLocal: p.precio,
      };

      let status = 0;
      let companyDelPlan: string | null = null;
      let precioWhop: string | null = null;

      try {
        const res = await fetch(
          `${base}/plans/${encodeURIComponent(p.whop_plan_id)}?account_id=${encodeURIComponent(companyEsperada)}`,
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              'Api-Version-Date': versionDate,
            },
            signal: AbortSignal.timeout(12_000),
            cache: 'no-store',
          },
        );
        status = res.status;
        if (res.status === 200) {
          const cuerpo = (await res.json()) as { account?: { id?: string }; initial_price?: number };
          companyDelPlan = cuerpo.account?.id ?? null;
          precioWhop = typeof cuerpo.initial_price === 'number' ? cuerpo.initial_price.toFixed(2) : null;
        }
      } catch (err) {
        const abortada = err instanceof Error && err.name === 'TimeoutError';
        return {
          ...comun,
          estado: 'indeterminado',
          companyDelPlan: null,
          precioWhop: null,
          detalle: abortada ? 'Whop no contestó en 12 segundos.' : 'No se pudo conectar con Whop.',
        };
      }

      const { estado, detalle } = clasificarPlan(companyEsperada, status, companyDelPlan);
      return { ...comun, estado, companyDelPlan, precioWhop, detalle };
    }),
  );
}
