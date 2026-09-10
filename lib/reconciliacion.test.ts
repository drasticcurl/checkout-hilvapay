import { describe, expect, it } from 'vitest';
import { emparejar, type CobroParaEmparejar } from './reconciliacion';
import type { PagoListado } from './whop';

/**
 * `emparejar` es la función más peligrosa del módulo de reconciliación: decide
 * qué pago de Whop le corresponde a un cobro que quedó sin `whop_payment_id`.
 * Un falso positivo marca como pagado un upsell que la persona nunca compró (o
 * le pega el pago del paso equivocado); un falso negativo deja un cobro colgado,
 * que es recuperable. Por eso todos los casos dudosos tienen que devolver null.
 */

const ORDEN = '11111111-1111-1111-1111-111111111111';
const PASO_1 = '22222222-2222-2222-2222-222222222222';
const PASO_2 = '33333333-3333-3333-3333-333333333333';
const CONFIG = 'ch_de_esta_orden';

function cobro(cambios: Partial<CobroParaEmparejar> = {}): CobroParaEmparejar {
  return {
    orden_id: ORDEN,
    pagina_id: PASO_1,
    whop_plan_id: 'plan_upsell',
    whop_checkout_config_id: null,
    ...cambios,
  };
}

function pago(
  id: string,
  metadata: Record<string, unknown> | null,
  extra: { planId?: string | null; configId?: string | null } = {},
): PagoListado {
  return {
    id,
    metadata,
    checkout_configuration_id: extra.configId ?? null,
    planId: extra.planId ?? null,
    created_at: '2026-09-10T19:00:00Z',
  };
}

describe('emparejar', () => {
  it('empareja por orden_id + pagina_id, que es lo que manda el cobro del upsell', () => {
    const pagos = [pago('pay_1', { orden_id: ORDEN, pagina_id: PASO_1 })];
    expect(emparejar(cobro(), pagos)).toEqual({ pago: pagos[0] });
  });

  it('NO empareja el pago de otro paso de la misma orden', () => {
    // El caso que justifica toda la función: una orden tiene front, upsell 1 y
    // upsell 2, y los tres llevan el mismo orden_id en el metadata. Emparejar
    // solo por orden_id le pegaría el pago del upsell 2 al upsell 1.
    const pagos = [pago('pay_1', { orden_id: ORDEN, pagina_id: PASO_2 })];
    expect(emparejar(cobro({ pagina_id: PASO_1 }), pagos)).toEqual({ pago: null, motivo: 'ninguno' });
  });

  it('elige el correcto cuando están los pagos de los dos pasos', () => {
    const pagos = [
      pago('pay_paso2', { orden_id: ORDEN, pagina_id: PASO_2 }),
      pago('pay_paso1', { orden_id: ORDEN, pagina_id: PASO_1 }),
    ];
    const r = emparejar(cobro({ pagina_id: PASO_1 }), pagos);
    expect(r.pago?.id).toBe('pay_paso1');
  });

  describe('el cobro del front', () => {
    it('empareja por checkout_configuration_id, incluso sin metadata', () => {
      // El caso en que el metadata no viajó. `checkout_configuration_id` es un
      // campo propio del objeto Payment y la columna de `ordenes` es única.
      const pagos = [pago('pay_front', null, { configId: CONFIG })];
      const r = emparejar(cobro({ whop_checkout_config_id: CONFIG }), pagos);
      expect(r.pago?.id).toBe('pay_front');
    });

    it('sin pagina_id en el metadata, empareja por plan', () => {
      const pagos = [pago('pay_front', { orden_id: ORDEN }, { planId: 'plan_front' })];
      const r = emparejar(cobro({ whop_plan_id: 'plan_front' }), pagos);
      expect(r.pago?.id).toBe('pay_front');
    });

    it('sin pagina_id y con otro plan, no empareja', () => {
      const pagos = [pago('pay_otro', { orden_id: ORDEN }, { planId: 'plan_distinto' })];
      expect(emparejar(cobro({ whop_plan_id: 'plan_front' }), pagos)).toEqual({
        pago: null,
        motivo: 'ninguno',
      });
    });

    it('dos null NO se consideran la misma checkout configuration', () => {
      // El bug que este test existe para prevenir: en JS `null === null`, así
      // que sin el chequeo de "la columna tiene valor", toda orden sin config
      // matchearía con todo pago sin config. Sería el peor falso positivo
      // posible: cualquier pago suelto de Whop pegado a cualquier cobro.
      const pagos = [pago('pay_ajeno', null, { configId: null })];
      expect(emparejar(cobro({ whop_checkout_config_id: null }), pagos)).toEqual({
        pago: null,
        motivo: 'ninguno',
      });
    });

    it('la config de otra orden no empareja', () => {
      const pagos = [pago('pay_de_otro', null, { configId: 'ch_de_otra_orden' })];
      expect(emparejar(cobro({ whop_checkout_config_id: CONFIG }), pagos)).toEqual({
        pago: null,
        motivo: 'ninguno',
      });
    });
  });

  it('no empareja un pago de otra orden', () => {
    const pagos = [pago('pay_1', { orden_id: 'otra-orden', pagina_id: PASO_1 })];
    expect(emparejar(cobro(), pagos)).toEqual({ pago: null, motivo: 'ninguno' });
  });

  it('sin metadata y sin config no empareja nunca', () => {
    // Un pago hecho desde la página de Whop, o el de KashPay que ya existe en la
    // cuenta: fuera de este checkout.
    const pagos = [pago('pay_externo', null, { planId: 'plan_upsell' })];
    expect(emparejar(cobro(), pagos)).toEqual({ pago: null, motivo: 'ninguno' });
  });

  it('metadata de otro sistema no empareja', () => {
    // La cuenta tiene pagos viejos de KashPay con su propio metadata.
    const pagos = [
      pago('pay_kashpay', { kashpay_checkout_id: 'abc', kashpay_transaction_id: 'def' }, { planId: 'plan_upsell' }),
    ];
    expect(emparejar(cobro(), pagos)).toEqual({ pago: null, motivo: 'ninguno' });
  });

  it('dos candidatos válidos devuelven ambiguo y no el primero', () => {
    // Puede pasar con dos intentos del front sobre la misma orden. Elegir uno
    // sería adivinar: se deja para el webhook o para una persona.
    const pagos = [
      pago('pay_a', { orden_id: ORDEN }, { planId: 'plan_front' }),
      pago('pay_b', { orden_id: ORDEN }, { planId: 'plan_front' }),
    ];
    expect(emparejar(cobro({ whop_plan_id: 'plan_front' }), pagos)).toEqual({
      pago: null,
      motivo: 'ambiguo',
    });
  });

  it('una lista vacía no explota', () => {
    expect(emparejar(cobro(), [])).toEqual({ pago: null, motivo: 'ninguno' });
  });

  it('un orden_id que no es string no empareja', () => {
    // El metadata de Whop es jsonb libre: nada garantiza el tipo.
    const pagos = [pago('pay_x', { orden_id: 12345, pagina_id: PASO_1 })];
    expect(emparejar(cobro(), pagos)).toEqual({ pago: null, motivo: 'ninguno' });
  });

  it('un pagina_id vacío no cuenta como "sin pagina_id"', () => {
    // Si un string vacío se tratara como ausente, se caería al match por plan y
    // podría emparejar el paso equivocado.
    const pagos = [pago('pay_x', { orden_id: ORDEN, pagina_id: '' }, { planId: 'plan_upsell' })];
    expect(emparejar(cobro(), pagos)).toEqual({ pago: null, motivo: 'ninguno' });
  });
});
