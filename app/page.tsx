/**
 * La raíz del dominio no muestra nada. Este host solo sirve links de pago
 * (/pagos/<slug>) y el panel (/admin): una home con contenido solo le daría a un
 * curioso un lugar desde donde empezar a mirar.
 */
export default function Home() {
  return (
    // `100dvh` y no `100vh`: en Safari de iOS el 100vh incluye la barra de
    // direcciones, así que la página salta cuando esa barra se esconde.
    <main className="flex min-h-[100dvh] items-center justify-center p-8">
      <p className="text-sm text-texto-suave">Nada por acá.</p>
    </main>
  );
}
