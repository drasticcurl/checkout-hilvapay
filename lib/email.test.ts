import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mockeamos lib/db ANTES de importar lib/email, así el módulo bajo test nunca
// toca una conexión real de Postgres: esto es una prueba de la lógica del
// interruptor y del envío, no una prueba de integración con la base.
const qMock = vi.fn();
const q1Mock = vi.fn();
vi.mock('./db', () => ({
  q: (...args: unknown[]) => qMock(...args),
  q1: (...args: unknown[]) => q1Mock(...args),
}));

import { _resetClienteResendParaTests, emailsActivos, mandarEmailDeEntrega } from './email';

const cobroDeEjemplo = {
  cobroId: 'cobro-1',
  email: 'compradora@example.com',
  nombre: 'Compradora',
  productoNombre: 'App agua de arroz',
};

describe('email', () => {
  beforeEach(() => {
    qMock.mockReset();
    q1Mock.mockReset();
    process.env.RESEND_FROM_EMAIL = 'ventas@hilvanapp.com';
    process.env.RESEND_API_KEY = 'sin-usar-en-estos-tests-salvo-que-se-inyecte-un-mock';
    _resetClienteResendParaTests(undefined);
  });

  afterEach(() => {
    delete process.env.RESEND_FROM_EMAIL;
    delete process.env.RESEND_API_KEY;
    _resetClienteResendParaTests(undefined);
  });

  describe('emailsActivos', () => {
    it('lee el interruptor de la tabla config', async () => {
      q1Mock.mockResolvedValueOnce({ emails_activos: true });
      await expect(emailsActivos()).resolves.toBe(true);

      q1Mock.mockResolvedValueOnce({ emails_activos: false });
      await expect(emailsActivos()).resolves.toBe(false);
    });

    it('sin fila en config, asume apagado (default seguro)', async () => {
      q1Mock.mockResolvedValueOnce(null);
      await expect(emailsActivos()).resolves.toBe(false);
    });
  });

  describe('mandarEmailDeEntrega — EL INTERRUPTOR APAGADO NO MANDA NADA', () => {
    it('con emails_activos=false devuelve {enviado:false, motivo:"apagado"} y CERO llamadas a Resend', async () => {
      // select emails_activos from config -> false
      q1Mock.mockResolvedValueOnce({ emails_activos: false });

      const enviarMock = vi.fn();
      _resetClienteResendParaTests({ emails: { send: enviarMock } } as never);

      const r = await mandarEmailDeEntrega(cobroDeEjemplo);

      expect(r).toEqual({ enviado: false, motivo: 'apagado' });
      expect(enviarMock).not.toHaveBeenCalled();
      // Tampoco se llegó a consultar email_enviado_at: el interruptor corta
      // ANTES de tocar el cobro.
      expect(q1Mock).toHaveBeenCalledTimes(1);
      // Ni se escribió nada (no se marcó email_enviado_at).
      expect(qMock).not.toHaveBeenCalled();
    });
  });

  describe('mandarEmailDeEntrega — con el interruptor prendido', () => {
    it('sin RESEND_API_KEY no manda nada, aunque esté prendido', async () => {
      delete process.env.RESEND_API_KEY;
      _resetClienteResendParaTests(undefined);
      q1Mock.mockResolvedValueOnce({ emails_activos: true }); // interruptor

      const r = await mandarEmailDeEntrega(cobroDeEjemplo);
      expect(r).toEqual({ enviado: false, motivo: 'sin_api_key' });
    });

    it('con email_enviado_at ya seteado, no manda de nuevo (idempotencia)', async () => {
      q1Mock.mockResolvedValueOnce({ emails_activos: true }); // interruptor
      q1Mock.mockResolvedValueOnce({ email_enviado_at: new Date('2026-01-01T00:00:00Z') }); // ya enviado

      const enviarMock = vi.fn();
      _resetClienteResendParaTests({ emails: { send: enviarMock } } as never);

      const r = await mandarEmailDeEntrega(cobroDeEjemplo);

      expect(r).toEqual({ enviado: false, motivo: 'ya_enviado' });
      expect(enviarMock).not.toHaveBeenCalled();
    });

    it('sin RESEND_FROM_EMAIL no manda nada', async () => {
      delete process.env.RESEND_FROM_EMAIL;
      q1Mock.mockResolvedValueOnce({ emails_activos: true }); // interruptor
      q1Mock.mockResolvedValueOnce({ email_enviado_at: null }); // no enviado

      const enviarMock = vi.fn();
      _resetClienteResendParaTests({ emails: { send: enviarMock } } as never);

      const r = await mandarEmailDeEntrega(cobroDeEjemplo);

      expect(r).toEqual({ enviado: false, motivo: 'sin_remitente' });
      expect(enviarMock).not.toHaveBeenCalled();
    });

    it('todo prendido y sin envío previo: llama a Resend y marca email_enviado_at', async () => {
      q1Mock.mockResolvedValueOnce({ emails_activos: true }); // interruptor
      q1Mock.mockResolvedValueOnce({ email_enviado_at: null }); // no enviado
      qMock.mockResolvedValueOnce([]); // el UPDATE de email_enviado_at

      const enviarMock = vi.fn().mockResolvedValue({ data: { id: 'resend_1' }, error: null });
      _resetClienteResendParaTests({ emails: { send: enviarMock } } as never);

      const r = await mandarEmailDeEntrega(cobroDeEjemplo);

      expect(r).toEqual({ enviado: true });
      expect(enviarMock).toHaveBeenCalledTimes(1);
      expect(enviarMock).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'ventas@hilvanapp.com',
          to: 'compradora@example.com',
          html: expect.stringContaining('App agua de arroz'),
          text: expect.stringContaining('App agua de arroz'),
        }),
      );
      // Se marca email_enviado_at DESPUÉS de que Resend confirmó.
      expect(qMock).toHaveBeenCalledWith(
        'update cobros set email_enviado_at = now() where id = $1',
        ['cobro-1'],
      );
    });

    it('si Resend tira, devuelve {enviado:false} y no marca email_enviado_at', async () => {
      q1Mock.mockResolvedValueOnce({ emails_activos: true }); // interruptor
      q1Mock.mockResolvedValueOnce({ email_enviado_at: null }); // no enviado

      const enviarMock = vi.fn().mockRejectedValue(new Error('resend caído'));
      _resetClienteResendParaTests({ emails: { send: enviarMock } } as never);

      const r = await mandarEmailDeEntrega(cobroDeEjemplo);

      expect(r.enviado).toBe(false);
      expect(r.motivo).toContain('error_resend');
      expect(qMock).not.toHaveBeenCalled();
    });
  });
});
