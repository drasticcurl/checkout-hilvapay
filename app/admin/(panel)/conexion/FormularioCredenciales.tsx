'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CheckCircle, Warning, WarningCircle } from '@phosphor-icons/react/ssr';
import type { EstadoCredenciales } from '@/lib/whop-credenciales';
import { Aviso, Boton, Campo, Tarjeta, clasesControl } from '@/components/panel/ui';
import { Dialogo } from '@/components/panel/Dialogo';

type Resultado =
  | { tipo: 'nada' }
  | { tipo: 'probando' }
  | { tipo: 'ok'; companyNombre: string }
  | { tipo: 'error'; motivo: string };

/**
 * El formulario de credenciales de Whop.
 *
 * Tres decisiones que vale explicar:
 *
 *  1. **El campo de la API key arranca VACÍO y vacío significa "dejá la que
 *     está".** El estado que llega del server nunca trae la key, solo sus
 *     últimos cuatro caracteres, así que no hay nada con qué prellenarlo. Y como
 *     vacío conserva la actual, cambiar solo el biz id no obliga a ir a buscar la
 *     key a ningún lado.
 *
 *  2. **Probar y guardar son dos botones distintos.** Probar no escribe nada, así
 *     que se puede tantear sin consecuencias. Guardar vuelve a verificar del lado
 *     del servidor de todas formas: confiar en que el usuario probó antes sería
 *     confiar en un paso que se puede saltear.
 *
 *  3. **Guardar pide la contraseña del panel.** Es la acción de mayor privilegio
 *     que hay acá: una key y un biz id ajenos mandan los cobros siguientes a otra
 *     cuenta de Whop.
 */
export function FormularioCredenciales({ estado }: { estado: EstadoCredenciales }): JSX.Element {
  const router = useRouter();

  const [apiKey, setApiKey] = useState('');
  const [companyId, setCompanyId] = useState(estado.companyId);
  const [base, setBase] = useState(estado.base);
  const [versionDate, setVersionDate] = useState(estado.versionDate);

  const [resultado, setResultado] = useState<Resultado>({ tipo: 'nada' });
  const [confirmando, setConfirmando] = useState<'guardar' | 'volver' | null>(null);
  const [password, setPassword] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [errorGuardado, setErrorGuardado] = useState<string | null>(null);

  const cuerpo = () => ({ apiKey, companyId, base, versionDate });

  async function probar(): Promise<void> {
    setResultado({ tipo: 'probando' });
    try {
      const res = await fetch('/api/admin/whop/credenciales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo()),
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

  async function confirmar(): Promise<void> {
    setGuardando(true);
    setErrorGuardado(null);
    const volviendo = confirmando === 'volver';
    try {
      const res = await fetch('/api/admin/whop/credenciales', {
        method: volviendo ? 'DELETE' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(volviendo ? { password } : { ...cuerpo(), password }),
      });
      const data = (await res.json()) as { ok?: boolean; motivo?: string };
      if (!res.ok || !data.ok) {
        setErrorGuardado(data.motivo ?? 'No se pudo guardar.');
        return;
      }
      setConfirmando(null);
      setPassword('');
      setApiKey('');
      setResultado({ tipo: 'nada' });
      router.refresh();
    } catch {
      setErrorGuardado('No se pudo contactar al servidor.');
    } finally {
      setGuardando(false);
    }
  }

  function cerrarDialogo(): void {
    if (guardando) return;
    setConfirmando(null);
    setPassword('');
    setErrorGuardado(null);
  }

  return (
    <>
      <Tarjeta className="space-y-5 p-5">
        <Campo
          etiqueta="API key de Whop"
          htmlFor="whop-api-key"
          ayuda={
            estado.apiKeyEnmascarada !== '····'
              ? `Dejalo vacío para conservar la que está puesta (termina en ${estado.apiKeyEnmascarada.slice(-4)}).`
              : 'Dashboard de Whop → Developer → Account API keys → Create.'
          }
        >
          <input
            id="whop-api-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="pegá la key nueva"
            className={clasesControl('font-mono')}
          />
        </Campo>

        <Campo
          etiqueta="Company id"
          htmlFor="whop-company-id"
          ayuda="El biz_… del negocio. Sale en las URLs del dashboard de Whop."
        >
          <input
            id="whop-company-id"
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            placeholder="biz_XXXXXXXXXXXX"
            spellCheck={false}
            className={clasesControl('font-mono')}
          />
        </Campo>

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            etiqueta="URL base de la API"
            htmlFor="whop-base"
            ayuda="Producción es https://api.whop.com/api/v1"
          >
            <input
              id="whop-base"
              value={base}
              onChange={(e) => setBase(e.target.value)}
              spellCheck={false}
              className={clasesControl('font-mono')}
            />
          </Campo>

          <Campo
            etiqueta="Api-Version-Date"
            htmlFor="whop-version"
            ayuda="Cambiarla cambia la forma de las respuestas."
          >
            <input
              id="whop-version"
              value={versionDate}
              onChange={(e) => setVersionDate(e.target.value)}
              spellCheck={false}
              className={clasesControl('font-mono')}
            />
          </Campo>
        </div>

        {resultado.tipo === 'ok' ? (
          <Aviso tono="vivo" icono={<CheckCircle size={16} aria-hidden="true" />} rol="status">
            Whop contestó. La cuenta es <strong>{resultado.companyNombre}</strong>. Todavía no se guardó
            nada.
          </Aviso>
        ) : resultado.tipo === 'error' ? (
          <Aviso tono="peligro" icono={<WarningCircle size={16} aria-hidden="true" />} rol="alert">
            {resultado.motivo}
          </Aviso>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-panel-borde pt-4">
          <Boton variante="secundario" onClick={() => void probar()} disabled={resultado.tipo === 'probando'}>
            {resultado.tipo === 'probando' ? 'Probando…' : 'Probar contra Whop'}
          </Boton>
          <Boton variante="primario" onClick={() => setConfirmando('guardar')}>
            Guardar y usar estas
          </Boton>
          {estado.fuente === 'base' && estado.entornoCompleto ? (
            <Boton variante="fantasma" onClick={() => setConfirmando('volver')}>
              Volver a las del entorno
            </Boton>
          ) : null}
        </div>

        {!estado.hayClaveDeCifrado ? (
          <Aviso tono="alerta" icono={<Warning size={16} aria-hidden="true" />}>
            Falta <span className="font-mono">CONFIG_ENCRYPTION_KEY</span> en el servidor, así que la key
            no se puede guardar cifrada y el formulario va a rechazar el guardado. Generá una con{' '}
            <span className="font-mono">openssl rand -hex 32</span>, ponela en el{' '}
            <span className="font-mono">.env.production</span> y reiniciá el proceso.
          </Aviso>
        ) : null}
      </Tarjeta>

      {confirmando ? (
        <Dialogo
          titulo={confirmando === 'volver' ? 'Volver a las del entorno' : 'Cambiar las credenciales'}
          descripcion={
            confirmando === 'volver'
              ? 'Se borra el override de la base y el servicio vuelve a usar las variables de entorno.'
              : 'Se verifica contra Whop y, si contesta bien, quedan activas para el próximo cobro.'
          }
          onCerrar={cerrarDialogo}
          ancho="sm"
          pie={
            <>
              <Boton variante="fantasma" onClick={cerrarDialogo} disabled={guardando}>
                Cancelar
              </Boton>
              <Boton
                variante={confirmando === 'volver' ? 'peligro' : 'vivo'}
                onClick={() => void confirmar()}
                disabled={guardando || password.length === 0}
              >
                {guardando ? 'Guardando…' : confirmando === 'volver' ? 'Volver al entorno' : 'Confirmar'}
              </Boton>
            </>
          }
        >
          <div className="flex gap-3 rounded-ctrl border border-alerta-borde bg-alerta-suave px-3.5 py-3">
            <Warning size={17} className="mt-px shrink-0 text-alerta" aria-hidden="true" />
            <p className="text-[13px] leading-relaxed text-alerta">
              Los cobros siguientes van a usar estas credenciales. Una key o un biz id de otra cuenta
              hacen que la plata entre en esa otra cuenta.
            </p>
          </div>

          <Campo etiqueta="Contraseña del panel" htmlFor="whop-password">
            <input
              id="whop-password"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={clasesControl()}
            />
          </Campo>

          {errorGuardado ? (
            <p role="alert" className="text-[13px] font-medium text-peligro">
              {errorGuardado}
            </p>
          ) : null}
        </Dialogo>
      ) : null}
    </>
  );
}
