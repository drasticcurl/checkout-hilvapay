/**
 * Tests del snippet de wallet: el botón que SÍ cobra hoy.
 *
 * Los del botón off-session viven en `integracion.test.ts`. Este archivo cubre la
 * variante que el panel entrega por default desde que se midió que
 * `POST /payments` off-session está bloqueado del lado de Whop.
 *
 * Lo que se fija acá es el contrato con `loader.js`: el atributo tiene que ser
 * `data-hilvana-wallet` y no `data-hilvana-upsell`. Son dos caminos de cobro
 * distintos y confundirlos no da ningún error visible — el botón simplemente no
 * cobra, o cobra por el camino que Whop rechaza.
 */
import { describe, expect, it } from 'vitest';
import {
  integracionDeFunnel,
  snippetWalletHtml,
  snippetWalletJsx,
} from './integracion';

describe('snippetWalletHtml / snippetWalletJsx', () => {
  const paso = {
    slug: 'upsell-1',
    tipo: 'upsell' as const,
    nombre: 'Upsell 1',
    url_externa: 'https://elfunnel.com/upsell1',
    permite_rechazo: false,
    producto: { nombre: 'Extra', precio: '19.90', moneda: 'usd' },
    delay_segundos: null,
  };

  // Un div vacío y NO un <button>: el loader le inyecta adentro el custom element
  // de Whop, que trae su propio botón con el estilo nativo del wallet. Apple no
  // permite reestilar el suyo, así que un <button> nuestro alrededor sobraría.
  it('es un div vacío con el slug en data-hilvana-wallet', () => {
    expect(snippetWalletHtml(paso)).toBe('<div data-hilvana-wallet="upsell-1"></div>');
  });

  it('en JSX se autocierra', () => {
    expect(snippetWalletJsx(paso)).toBe('<div data-hilvana-wallet="upsell-1" />');
  });

  // El atributo es OTRO que el del botón off-session, y esa distinción es el
  // contrato entero: `wallet` cobra on-session (funciona), `upsell` cobra
  // off-session (Whop lo rechaza con un 400 genérico).
  it('no usa el atributo del cobro off-session', () => {
    expect(snippetWalletHtml(paso)).not.toContain('data-hilvana-upsell');
    expect(snippetWalletJsx(paso)).not.toContain('data-hilvana-upsell');
  });

  it('no lleva el precio en la etiqueta: el texto lo pone Whop dentro del wallet', () => {
    expect(snippetWalletHtml(paso)).not.toContain('19');
  });
});

describe('integracionDeFunnel con wallet', () => {
  const front = {
    slug: 'front',
    tipo: 'front' as const,
    nombre: null,
    url_externa: null,
    permite_rechazo: false,
    producto: { nombre: 'Front', precio: '1.00', moneda: 'usd' },
    delay_segundos: null,
  };
  const upsell = {
    slug: 'upsell-1',
    tipo: 'upsell' as const,
    nombre: 'Upsell 1',
    url_externa: 'https://elfunnel.com/upsell1',
    permite_rechazo: true,
    producto: { nombre: 'Extra', precio: '19.90', moneda: 'usd' },
    delay_segundos: null,
  };

  it('entrega las dos variantes por paso de upsell', () => {
    const i = integracionDeFunnel('https://pay.hilvanapp.com', [front, upsell], {
      'upsell-1': 'https://elfunnel.com/downsell',
    });
    expect(i.pasos).toHaveLength(1);
    const p = i.pasos[0]!;

    expect(p.htmlWallet).toContain('data-hilvana-wallet="upsell-1"');
    expect(p.jsxWallet).toContain('data-hilvana-wallet="upsell-1"');
    expect(p.html).toContain('data-hilvana-upsell="upsell-1"');

    // El "no gracias" es del funnel y no depende de con qué se cobre, así que va
    // en las dos variantes y apunta al mismo lado.
    expect(p.htmlWallet).toContain('https://elfunnel.com/downsell');
    expect(p.html).toContain('https://elfunnel.com/downsell');
  });

  it('sin rechazo, el bloque de wallet es solo el div', () => {
    const i = integracionDeFunnel('https://pay.hilvanapp.com', [
      { ...upsell, permite_rechazo: false },
    ]);
    expect(i.pasos[0]!.htmlWallet).toBe('<div data-hilvana-wallet="upsell-1"></div>');
  });

  it('el paso front no genera snippet: su checkout es de este lado', () => {
    const i = integracionDeFunnel('https://pay.hilvanapp.com', [front]);
    expect(i.pasos).toHaveLength(0);
  });
});
