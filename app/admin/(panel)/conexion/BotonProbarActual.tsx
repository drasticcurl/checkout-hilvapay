'use client';

import { useState } from 'react';
import { CheckCircle, MagnifyingGlass, WarningCircle } from '@phosphor-icons/react/ssr';
import { Boton } from '@/components/panel/ui';

type Resultado = { tipo: 'nada' } | { tipo: 'probando' } | { tipo: 'ok'; companyNombre: string } | { tipo: 'error'; motivo: string };

/**
 * Botón standalone en la tarjeta de solo-lectura: prueba la API key QUE YA ESTÁ
 * GUARDADA contra Whop, sin abrir el formulario de abajo.
 *
 * Reusa `POST /api/admin/whop/credenciales`. Ese endpoint solo completa
 * `apiKey` en blanco con la que ya está guardada (`leerCredenciales` en el
 * route handler) — `companyId`, `base` y `versionDate` los exige explícitos,
 * porque el formulario real siempre los manda (arranca precargado con
 * `estado.companyId` y compañía). Por eso este botón viaja con esos tres
 * campos ya resueltos desde `estado`, y `apiKey` vacío para que el servidor
 * complete con la guardada — el browser nunca la tiene.
 */
export function BotonProbarActual({
  estado,
}: {
  estado: { companyId: string; base: string; versionDate: string };
}): JSX.Element {
  const [resultado, setResultado] = useState<Resultado>({ tipo: 'nada' });

  async function probar(): Promise<void> {
    setResultado({ tipo: 'probando' });
    try {
      const res = await fetch('/api/admin/whop/credenciales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: estado.companyId,
          base: estado.base,
          versionDate: estado.versionDate,
        }),
      });
      const data = (await res.json()) as
        | { ok: true; companyNombre: string }
        | { ok: false; motivo: string };
      setResultado(
        data.ok
          ? { tipo: 'ok', companyNombre: data.companyNombre }
          : { tipo: 'error', motivo: data.motivo },
      );
    } catch {
      setResultado({ tipo: 'error', motivo: 'No se pudo contactar al servidor.' });
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Boton
        variante="secundario"
        onClick={() => void probar()}
        disabled={resultado.tipo === 'probando'}
        icono={<MagnifyingGlass size={14} aria-hidden="true" />}
      >
        {resultado.tipo === 'probando' ? 'Probando…' : 'Testear API key'}
      </Boton>
      {resultado.tipo === 'ok' ? (
        <span className="flex items-center gap-1 text-[12px] text-vivo" role="status">
          <CheckCircle size={13} aria-hidden="true" />
          Responde: {resultado.companyNombre}
        </span>
      ) : resultado.tipo === 'error' ? (
        <span className="flex items-center gap-1 text-[12px] text-peligro" role="alert">
          <WarningCircle size={13} aria-hidden="true" />
          {resultado.motivo}
        </span>
      ) : null}
    </div>
  );
}
