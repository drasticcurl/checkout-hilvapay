/**
 * La plantilla del email de entrega. HTML inline (los clientes de correo
 * ignoran <style> con media queries en muchos casos, así que todo va en el
 * atributo `style`) y su versión en texto plano.
 *
 * Sin imágenes remotas obligatorias: si el logo no carga —proxy corporativo,
 * bloqueo de imágenes por default en Gmail/Outlook— el email tiene que seguir
 * siendo legible y decir lo mismo. Por eso no hay ningún `<img>` acá.
 *
 * Lleva el nombre REAL del producto (`productos.nombre`), no el nombre "soft"
 * del plan de Whop: es toda la razón por la que ese nombre vive en esta base
 * (D10 del plan) y no se lee del lado de Whop.
 */

export type DatosEntrega = {
  nombre: string | null;
  productoNombre: string;
};

export function entregaHtml({ nombre, productoNombre }: DatosEntrega): string {
  const saludo = nombre ? `Hola ${escapeHtml(nombre)}` : 'Hola';
  const anio = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Tu compra está lista</title>
</head>
<body style="margin:0;padding:0;background:#F5F3EF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F3EF;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border-radius:12px;border:1px solid #E7E3DC;">
          <tr>
            <td style="padding:32px 32px 8px;">
              <p style="margin:0 0 4px;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#8A8578;">Confirmación de compra</p>
              <h1 style="margin:0;font-size:22px;line-height:1.3;color:#22201B;">${saludo}, tu acceso está listo</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;">
              <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#3A362E;">
                Recibimos tu pago de <strong>${escapeHtml(productoNombre)}</strong> y ya está disponible.
              </p>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#3A362E;">
                Si esperabas un link o instrucciones específicas de acceso y no las ves acá, respondé este
                correo y te ayudamos directamente: es la vía más rápida para resolverlo.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 32px;">
              <p style="margin:0;font-size:13px;line-height:1.6;color:#8A8578;">
                Guardá este correo como comprobante de tu compra.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;background:#F5F3EF;border-top:1px solid #E7E3DC;border-radius:0 0 12px 12px;">
              <p style="margin:0;font-size:12px;color:#A3A093;">© ${anio} hilvanapp.com</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function entregaTexto({ nombre, productoNombre }: DatosEntrega): string {
  const saludo = nombre ? `Hola ${nombre}` : 'Hola';
  return [
    `${saludo}, tu acceso está listo`,
    '',
    `Recibimos tu pago de ${productoNombre} y ya está disponible.`,
    '',
    'Si esperabas un link o instrucciones específicas de acceso y no las ves acá,',
    'respondé este correo y te ayudamos directamente.',
    '',
    'Guardá este correo como comprobante de tu compra.',
  ].join('\n');
}

/** Evita que un nombre con `<` o `&` rompa el markup del email. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
