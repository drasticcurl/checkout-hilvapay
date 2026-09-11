/**
 * Tests de `lib/admin/planes.ts`.
 *
 * El caso que importa es el primero: un plan de OTRA company devuelve **200**, así
 * que clasificar por status HTTP daría "todo bien" justo en el único caso que
 * rompe los cobros. Está medido contra la API real el 2026-09-11 y ese test es el
 * que impide que alguien "simplifique" esto a un `res.ok`.
 */
import { describe, expect, it } from 'vitest';
import { clasificarPlan, hayProblemas, precioDesfasado, type PlanRevisado } from './planes';

const ATLAS = 'biz_LHktpJ17c83CFt';
const SINVANAPP = 'biz_Me8Lbiv174brtM';

describe('clasificarPlan', () => {
  it('un plan de OTRA company devuelve 200 y aun así es un problema', () => {
    // Medido en producción: GET /plans/plan_hgNXAvG16M9ix?account_id=<atlas>
    // responde 200 con account.id = biz_Me8Lbiv174brtM. Cobrar con él falla con el
    // 400 genérico de Whop, que no menciona companies.
    expect(clasificarPlan(ATLAS, 200, SINVANAPP)).toEqual({ estado: 'otra_company', detalle: null });
  });

  it('el plan de la company activa coincide', () => {
    expect(clasificarPlan(ATLAS, 200, ATLAS)).toEqual({ estado: 'coincide', detalle: null });
  });

  it('404 es un plan que no existe: id mal escrito o borrado', () => {
    expect(clasificarPlan(ATLAS, 404, null)).toEqual({ estado: 'no_existe', detalle: null });
  });

  it('401 y 403 son "no pudimos preguntar", NO "el plan está mal"', () => {
    // Marcarlos como error del plan mandaría a alguien a cambiar un whop_plan_id
    // correcto porque la key perdió un permiso.
    const a = clasificarPlan(ATLAS, 401, null);
    const b = clasificarPlan(ATLAS, 403, null);
    expect(a.estado).toBe('indeterminado');
    expect(b.estado).toBe('indeterminado');
    expect(a.detalle).toContain('401');
    expect(b.detalle).toContain('403');
  });

  it('un 5xx es indeterminado, no un problema del plan', () => {
    expect(clasificarPlan(ATLAS, 500, null).estado).toBe('indeterminado');
  });

  it('200 SIN la company dueña no se asume correcto', () => {
    // Asumir que está bien cuando no se sabe es exactamente el error que este
    // módulo existe para evitar.
    const r = clasificarPlan(ATLAS, 200, null);
    expect(r.estado).toBe('indeterminado');
    expect(r.detalle).toContain('sin la company');
  });
});

describe('hayProblemas', () => {
  function rev(estado: PlanRevisado['estado']): PlanRevisado {
    return {
      productoId: 'p',
      productoNombre: 'Producto',
      whopPlanId: 'plan_x',
      estado,
      companyDelPlan: null,
      precioWhop: null,
      precioLocal: '1.00',
      detalle: null,
    };
  }

  it('otra_company y no_existe son problemas', () => {
    expect(hayProblemas([rev('otra_company')])).toBe(true);
    expect(hayProblemas([rev('no_existe')])).toBe(true);
  });

  it('indeterminado NO cuenta como problema: no se sabe', () => {
    // Si contara, un timeout de Whop pintaría toda la pantalla en rojo y haría
    // dudar de una configuración que está bien.
    expect(hayProblemas([rev('indeterminado')])).toBe(false);
  });

  it('todo coincide, sin problemas', () => {
    expect(hayProblemas([rev('coincide'), rev('coincide')])).toBe(false);
  });

  it('alcanza uno malo entre varios buenos', () => {
    expect(hayProblemas([rev('coincide'), rev('otra_company'), rev('coincide')])).toBe(true);
  });

  it('sin productos no hay problemas', () => {
    expect(hayProblemas([])).toBe(false);
  });
});

describe('precioDesfasado', () => {
  it("'2.00' y 2 no están desfasados: numeric(10,2) llega como string", () => {
    // pg devuelve numeric como string y Whop manda number. Compararlos crudos
    // reportaría un desfasaje en todos los productos.
    expect(precioDesfasado('2.00', '2.00')).toBe(false);
  });

  it('detecta un desfasaje real', () => {
    expect(precioDesfasado('9.90', '37.00')).toBe(true);
  });

  it('sin precio de Whop no se afirma nada', () => {
    expect(precioDesfasado('9.90', null)).toBe(false);
  });

  it('un precio no numérico no rompe ni reporta', () => {
    expect(precioDesfasado('gratis', '2.00')).toBe(false);
  });
});
