import { describe, expect, it } from 'vitest';
import { utmsParaMetadataWhop } from './metadata-whop';

describe('utmsParaMetadataWhop', () => {
  it('pasa todas las claves sin filtrar, incluido fbclid', () => {
    // A diferencia de extraerUtmsLimpias (lib/salidas.ts, T03), acá SÍ tiene
    // sentido que fbclid viaje: no hay contrato de destino que lo excluya.
    expect(utmsParaMetadataWhop({ utm_campaign: 'X|123', fbclid: 'abc' })).toEqual({
      utm_campaign: 'X|123',
      fbclid: 'abc',
    });
  });

  it('devuelve objeto vacío para null, no null', () => {
    // Whop espera un objeto para metadata: spread de {} no rompe el objeto
    // metadata resultante, spread de null sí (TypeError en runtime).
    expect(utmsParaMetadataWhop(null)).toEqual({});
  });

  it('devuelve objeto vacío para undefined', () => {
    expect(utmsParaMetadataWhop(undefined)).toEqual({});
  });

  it('trunca un valor de más de 500 caracteres', () => {
    const largo = 'a'.repeat(600);
    const resultado = utmsParaMetadataWhop({ utm_content: largo });
    expect(resultado.utm_content).toHaveLength(500);
    expect(resultado.utm_content).toBe('a'.repeat(500));
  });

  it('descarta valores vacíos', () => {
    expect(utmsParaMetadataWhop({ utm_source: '', utm_campaign: 'X' })).toEqual({ utm_campaign: 'X' });
  });

  it('el spread con orden_id/pagina_id no pisa esas claves si utms no las tiene', () => {
    const metadata = { orden_id: 'abc', pagina_id: 'def', ...utmsParaMetadataWhop({ utm_source: 'fb' }) };
    expect(metadata).toEqual({ orden_id: 'abc', pagina_id: 'def', utm_source: 'fb' });
  });
});
