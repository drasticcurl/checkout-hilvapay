import { describe, expect, it } from 'vitest';
import { normalizarSlug } from './paginas';

describe('normalizarSlug', () => {
  it('pasa a minúsculas y cambia espacios por guiones', () => {
    expect(normalizarSlug('Agua De Arroz 1')).toBe('agua-de-arroz-1');
  });

  it('recorta espacios al borde y cambia guion bajo por guion medio', () => {
    expect(normalizarSlug('  UPSELL_2  ')).toBe('upsell-2');
  });

  it('quita los diacríticos y conserva la letra base', () => {
    // Documentado: se le sacan los acentos en vez de descartar la letra, para
    // no dejar un slug irreconocible.
    expect(normalizarSlug('áéí')).toBe('aei');
  });

  it('descarta símbolos que no son a-z0-9-', () => {
    expect(normalizarSlug('¡Oferta!! 50% off')).toBe('oferta-50-off');
  });

  it('colapsa guiones repetidos', () => {
    expect(normalizarSlug('a---b')).toBe('a-b');
  });

  it('recorta guiones que quedan al borde', () => {
    expect(normalizarSlug('-hola-')).toBe('hola');
  });

  it('ya normalizado queda igual', () => {
    expect(normalizarSlug('aguadearroz1')).toBe('aguadearroz1');
  });

  it('un slug vacío o solo símbolos da string vacío', () => {
    expect(normalizarSlug('   ')).toBe('');
    expect(normalizarSlug('¡¡¡')).toBe('');
  });

  it('números se conservan tal cual', () => {
    expect(normalizarSlug('Upsell 3 - $17')).toBe('upsell-3-17');
  });
});
