import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CifradoInvalido,
  SinClaveDeCifrado,
  cifrar,
  descifrar,
  enmascarar,
  hayClaveDeCifrado,
  huella,
} from './cripto';

/** 32 bytes en hex. No es una clave real: es fija para que los tests sean deterministas. */
const CLAVE_A = 'a'.repeat(64);
const CLAVE_B = 'b'.repeat(64);

const original = process.env.CONFIG_ENCRYPTION_KEY;

beforeEach(() => {
  process.env.CONFIG_ENCRYPTION_KEY = CLAVE_A;
});

afterEach(() => {
  if (original === undefined) delete process.env.CONFIG_ENCRYPTION_KEY;
  else process.env.CONFIG_ENCRYPTION_KEY = original;
});

describe('cripto', () => {
  describe('ida y vuelta', () => {
    it('descifrar(cifrar(x)) devuelve x', async () => {
      const secreto = 'whopsk_1a2b3c4d5e6f7g8h9i0j';
      expect(await descifrar(await cifrar(secreto))).toBe(secreto);
    });

    it('sirve con acentos y emoji, que son los que rompen un cifrado hecho por bytes a mano', async () => {
      const raro = 'configuración ñ 🛡 fin';
      expect(await descifrar(await cifrar(raro))).toBe(raro);
    });

    it('sirve con un string vacío', async () => {
      expect(await descifrar(await cifrar(''))).toBe('');
    });

    it('el mismo texto cifrado dos veces da valores DISTINTOS (el IV es aleatorio)', async () => {
      const a = await cifrar('mismo-secreto');
      const b = await cifrar('mismo-secreto');
      expect(a).not.toBe(b);
      // Pero los dos descifran a lo mismo.
      expect(await descifrar(a)).toBe(await descifrar(b));
    });

    it('el valor guardado tiene la forma v1.iv.datos y no contiene el texto plano', async () => {
      const sobre = await cifrar('SECRETO-BUSCABLE');
      expect(sobre.split('.')).toHaveLength(3);
      expect(sobre.startsWith('v1.')).toBe(true);
      expect(sobre).not.toContain('SECRETO-BUSCABLE');
    });
  });

  describe('sin la clave configurada', () => {
    it('cifrar tira SinClaveDeCifrado y no devuelve el texto plano', async () => {
      delete process.env.CONFIG_ENCRYPTION_KEY;
      await expect(cifrar('secreto')).rejects.toBeInstanceOf(SinClaveDeCifrado);
    });

    it('hayClaveDeCifrado da false', () => {
      delete process.env.CONFIG_ENCRYPTION_KEY;
      expect(hayClaveDeCifrado()).toBe(false);
    });

    it('una clave del largo equivocado se rechaza en vez de derivarse', () => {
      process.env.CONFIG_ENCRYPTION_KEY = 'clave-corta';
      expect(hayClaveDeCifrado()).toBe(false);
    });

    it('acepta base64 de 32 bytes, no solo hex', () => {
      // 32 bytes de 0x01 en base64.
      process.env.CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
      expect(hayClaveDeCifrado()).toBe(true);
    });
  });

  describe('valores que no se pueden descifrar', () => {
    it('con OTRA clave falla, no devuelve basura', async () => {
      const sobre = await cifrar('secreto');
      process.env.CONFIG_ENCRYPTION_KEY = CLAVE_B;
      await expect(descifrar(sobre)).rejects.toBeInstanceOf(CifradoInvalido);
    });

    it('un dato manipulado falla por el tag de GCM', async () => {
      const sobre = await cifrar('secreto');
      const partes = sobre.split('.');
      // Se le cambia un caracter a los datos cifrados.
      partes[2] = partes[2].slice(0, -1) + (partes[2].endsWith('A') ? 'B' : 'A');
      await expect(descifrar(partes.join('.'))).rejects.toBeInstanceOf(CifradoInvalido);
    });

    it('una versión desconocida falla con un mensaje que la nombra', async () => {
      await expect(descifrar('v9.AAAAAAAAAAAAAAAA.AAAA')).rejects.toThrow(/v9/);
    });

    it('un valor sin las tres partes falla', async () => {
      await expect(descifrar('solo-esto')).rejects.toBeInstanceOf(CifradoInvalido);
    });

    it('un IV del largo equivocado falla', async () => {
      await expect(descifrar('v1.AAAA.AAAAAAAA')).rejects.toThrow(/IV/);
    });
  });

  describe('huella', () => {
    it('es estable para el mismo secreto', async () => {
      expect(await huella('key-1')).toBe(await huella('key-1'));
    });

    it('cambia con el secreto', async () => {
      expect(await huella('key-1')).not.toBe(await huella('key-2'));
    });

    it('no contiene el secreto', async () => {
      expect(await huella('SECRETO-BUSCABLE')).not.toContain('SECRETO');
    });

    it('cambia si cambia la clave de cifrado: está salada', async () => {
      const conA = await huella('misma-key');
      process.env.CONFIG_ENCRYPTION_KEY = CLAVE_B;
      expect(await huella('misma-key')).not.toBe(conA);
    });
  });

  describe('enmascarar', () => {
    it('deja ver solo los últimos 4', () => {
      expect(enmascarar('whopsk_abcdefgh1234')).toBe('····1234');
    });

    it('no filtra nada de un secreto corto', () => {
      expect(enmascarar('abc')).toBe('····');
    });

    it('ignora los espacios de los bordes', () => {
      expect(enmascarar('  whopsk_xyz9  ')).toBe('····xyz9');
    });
  });
});
