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

      // Se invierte un BIT de un byte del medio del ciphertext, decodificando y
      // volviendo a codificar.
      //
      // La versión anterior de este test cambiaba el ÚLTIMO CARÁCTER del base64
      // (`A` por `B`) y era FLAKY: abortó dos deploys antes de que se lo cazara
      // corriendo la suite en loop (falló en la corrida 8 de 12).
      //
      // El motivo es base64, no azar. El ciphertext de 'secreto' son 23 bytes =
      // 184 bits, que en base64url ocupan 31 caracteres = 186 bits: los últimos
      // DOS BITS son padding y el decodificador los descarta. Cuando el cambio de
      // `A` (000000) a `B` (000001) caía justo en esos bits, los bytes
      // decodificados quedaban idénticos, GCM validaba bien y el test fallaba
      // reportando "promise resolved instead of rejecting".
      //
      // Operar sobre los bytes hace la manipulación real siempre. El byte 0 se
      // evita por las dudas de que alguna implementación lo trate distinto, y el
      // XOR con 0xff garantiza que el byte cambie sea cual sea su valor — sumar 1
      // tendría el mismo problema de "a veces no cambia nada" si hubiera overflow
      // silencioso.
      const bytes = Buffer.from(partes[2], 'base64url');
      expect(bytes.length).toBeGreaterThan(1); // si esto falla, el formato cambió
      const i = Math.floor(bytes.length / 2);
      bytes[i] = bytes[i] ^ 0xff;
      partes[2] = bytes.toString('base64url');

      await expect(descifrar(partes.join('.'))).rejects.toBeInstanceOf(CifradoInvalido);
    });

    it('la manipulación de un dato se detecta SIEMPRE, en cualquier posición', async () => {
      // El test de arriba toca un byte fijo. Este recorre todos: es la propiedad
      // que de verdad importa de AES-GCM —cualquier alteración invalida el tag— y
      // es la que el test flaky no estaba probando.
      const sobre = await cifrar('secreto');
      const partes = sobre.split('.');
      const original = Buffer.from(partes[2], 'base64url');

      for (let i = 0; i < original.length; i++) {
        const bytes = Buffer.from(original);
        bytes[i] = bytes[i] ^ 0xff;
        const manipulado = [partes[0], partes[1], bytes.toString('base64url')].join('.');
        await expect(descifrar(manipulado)).rejects.toBeInstanceOf(CifradoInvalido);
      }
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
