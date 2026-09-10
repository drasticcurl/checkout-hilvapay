/**
 * La raíz del dominio no muestra nada. Este host solo sirve links de pago
 * (/pagos/<slug>) y el panel (/admin): una home con contenido solo le daría a un
 * curioso un lugar desde donde empezar a mirar.
 */
export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <p className="text-sm text-texto-suave">Nada por acá.</p>
    </main>
  );
}
