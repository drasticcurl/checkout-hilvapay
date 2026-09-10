import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Pago seguro',
  // Ninguna página de este dominio se indexa: son links de pago que dependen de
  // una orden viva.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="bg-white font-sans text-texto antialiased">{children}</body>
    </html>
  );
}
