/**
 * El 404 público. Lo ve un comprador que abrió un link de pago que no resuelve:
 * puede no haber existido nunca, puede estar apagado, o su funnel puede estar
 * apagado. **Los tres casos dicen exactamente lo mismo a propósito** — distinguir
 * "no existe" de "está apagado" le confirma a un curioso qué links existen.
 *
 * Sin links de navegación: no hay a dónde mandarlo desde este dominio, que solo
 * sirve links de pago y el panel.
 */
export default function NoEncontrado(): JSX.Element {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center px-6 py-16">
      <div className="max-w-[34ch] text-center">
        <p className="text-base font-semibold text-texto">Este link no está disponible</p>
        <p className="mt-2 text-sm leading-relaxed text-texto-suave">
          Puede haber vencido o haber cambiado de dirección. Si llegaste desde una oferta, volvé a
          abrirla desde ahí.
        </p>
      </div>
    </main>
  );
}
