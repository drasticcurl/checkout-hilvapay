'use client';

import { useEffect, useState } from 'react';

/**
 * Barra roja "La oferta expira en 11:24". Es urgencia, no un candado: cuando
 * llega a 00:00 se queda ahí y el botón de comprar sigue funcionando. Que el
 * timer bloqueara la compra sería perder una venta real por una animación.
 */
export function Timer({ minutos }: { minutos: number }) {
  const [segundosRestantes, setSegundosRestantes] = useState(() => Math.max(0, Math.round(minutos * 60)));

  useEffect(() => {
    if (segundosRestantes <= 0) return;
    const id = setInterval(() => {
      setSegundosRestantes((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [segundosRestantes > 0]);

  const mm = Math.floor(segundosRestantes / 60)
    .toString()
    .padStart(2, '0');
  const ss = (segundosRestantes % 60).toString().padStart(2, '0');

  return (
    <div className="w-full bg-urgencia py-2 text-center text-sm font-semibold text-white">
      La oferta expira en {mm}:{ss}
    </div>
  );
}
