import { describe, expect, it } from 'vitest';
import { armarUrlConToken, comoUuidONull, datosCompletos, formatearPrecio, normalizarEmail } from './utils';

describe('armarUrlConToken', () => {
  it('agrega ?ot= cuando la url no tiene querystring', () => {
    expect(armarUrlConToken('https://ejemplo.com/upsell', 'TOKEN123')).toBe(
      'https://ejemplo.com/upsell?ot=TOKEN123',
    );
  });

  it('agrega &ot= respetando el querystring existente, sin romperlo', () => {
    // Es el bug de la concatenación con "?": esto tiene que dar UN solo "?" y
    // los dos params separados por "&", no "?utm_source=fb?ot=...".
    expect(armarUrlConToken('https://ejemplo.com/upsell?utm_source=fb', 'TOKEN123')).toBe(
      'https://ejemplo.com/upsell?utm_source=fb&ot=TOKEN123',
    );
  });

  it('agrega &r=1 en modo recuperación', () => {
    const url = armarUrlConToken('https://ejemplo.com/upsell?utm_source=fb', 'TOKEN123', true);
    const parsed = new URL(url);
    expect(parsed.searchParams.get('ot')).toBe('TOKEN123');
    expect(parsed.searchParams.get('r')).toBe('1');
    expect(parsed.searchParams.get('utm_source')).toBe('fb');
  });

  it('no agrega r cuando recuperacion es false', () => {
    const url = armarUrlConToken('https://ejemplo.com/upsell', 'TOKEN123', false);
    expect(new URL(url).searchParams.has('r')).toBe(false);
  });
});

describe('normalizarEmail', () => {
  it('recorta espacios y pasa a minúsculas', () => {
    expect(normalizarEmail('  Juan@Mail.COM ')).toBe('juan@mail.com');
  });

  it('es un no-op sobre un email ya normalizado', () => {
    expect(normalizarEmail('juan@mail.com')).toBe('juan@mail.com');
  });
});

describe('comoUuidONull', () => {
  it('descarta un string que no es UUID', () => {
    expect(comoUuidONull('no-es-uuid')).toBeNull();
  });

  it('conserva un UUID válido', () => {
    const uuid = '123e4567-e89b-12d3-a456-426614174000';
    expect(comoUuidONull(uuid)).toBe(uuid);
  });

  it('devuelve null para undefined o vacío', () => {
    expect(comoUuidONull(undefined)).toBeNull();
    expect(comoUuidONull(null)).toBeNull();
    expect(comoUuidONull('')).toBeNull();
  });
});

describe('datosCompletos', () => {
  it('nombre de una letra es incompleto', () => {
    expect(datosCompletos('a', 'juan@mail.com')).toBe(false);
  });

  it('email sin @ es incompleto', () => {
    expect(datosCompletos('Juan Perez', 'no-es-email')).toBe(false);
  });

  it('nombre y email válidos están completos', () => {
    expect(datosCompletos('Juan Perez', 'juan@mail.com')).toBe(true);
  });

  it('espacios en los bordes no cuentan para el largo del nombre', () => {
    expect(datosCompletos('  a  ', 'juan@mail.com')).toBe(false);
  });
});

describe('formatearPrecio', () => {
  it('muestra 9.90, no 9.9', () => {
    expect(formatearPrecio('9.90', 'usd')).toBe('$9.90');
  });

  it('agrega el símbolo $ para usd', () => {
    expect(formatearPrecio('17.00', 'usd')).toBe('$17.00');
  });

  it('muestra el código de moneda cuando no es usd', () => {
    expect(formatearPrecio('9.90', 'brl')).toBe('BRL 9.90');
  });

  it('si el string no es numérico, lo devuelve tal cual con el símbolo', () => {
    expect(formatearPrecio('no-numero', 'usd')).toBe('$no-numero');
  });
});
