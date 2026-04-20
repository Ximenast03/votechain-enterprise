// ─────────────────────────────────────────────────────────────────────────────
// mailer.js  —  Servicio de envío de correos con Nodemailer
// ─────────────────────────────────────────────────────────────────────────────
const nodemailer = require('nodemailer');

// Configura el transporter usando las variables de entorno
// En .env agrega:
//   MAIL_HOST=smtp.gmail.com
//   MAIL_PORT=587
//   MAIL_USER=tucorreo@gmail.com
//   MAIL_PASS=tu_app_password   (contraseña de aplicación de Google)
//   MAIL_FROM=VoteChain Enterprise <tucorreo@gmail.com>

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  if (!process.env.MAIL_USER || !process.env.MAIL_PASS) {
    console.warn('⚠️  MAIL_USER / MAIL_PASS no configurados — emails desactivados');
    return null;
  }

  transporter = nodemailer.createTransport({
    host:   process.env.MAIL_HOST || 'smtp.gmail.com',
    port:   parseInt(process.env.MAIL_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS,
    },
  });

  return transporter;
}

/**
 * Envía el correo de restablecimiento de contraseña.
 * @param {string} to       - Email de destino (correo de respaldo)
 * @param {string} userName - Nombre del usuario
 * @param {string} code     - Código de 6 dígitos
 */
async function sendResetCode(to, userName, code) {
  const t = getTransporter();
  if (!t) {
    // En desarrollo sin configuración de correo, imprimimos en consola
    console.log(`\n📧 [DEV] Código de restablecimiento para ${userName} (${to}): ${code}\n`);
    return { simulated: true };
  }

  const from = process.env.MAIL_FROM || `VoteChain Enterprise <${process.env.MAIL_USER}>`;

  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#060b18;font-family:'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#060b18;padding:40px 0">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#0c1428;border:1px solid #1a3050;border-radius:20px;overflow:hidden">

        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#2f80ed,#7c3aed);padding:32px;text-align:center">
          <div style="font-size:36px;margin-bottom:8px">⛓️</div>
          <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700;letter-spacing:-.3px">VoteChain Enterprise</h1>
          <p style="color:rgba(255,255,255,.7);margin:4px 0 0;font-size:13px">Sistema de votación corporativa con blockchain</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:36px 40px">
          <p style="color:#dbe7f5;font-size:15px;margin:0 0 8px">Hola, <strong>${userName}</strong></p>
          <p style="color:#4a6080;font-size:13px;margin:0 0 28px;line-height:1.6">
            Recibimos una solicitud para restablecer la contraseña de tu cuenta en VoteChain Enterprise.
            Usa el código de verificación a continuación:
          </p>

          <!-- Code box -->
          <div style="background:#060b18;border:1px solid #1a3050;border-radius:14px;padding:28px;text-align:center;margin-bottom:28px">
            <p style="color:#4a6080;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;font-weight:600">Código de verificación</p>
            <div style="font-size:42px;font-weight:700;letter-spacing:12px;color:#2f80ed;font-family:'Courier New',monospace">${code}</div>
            <p style="color:#4a6080;font-size:12px;margin:12px 0 0">⏱️ Este código expira en <strong style="color:#f59e0b">15 minutos</strong></p>
          </div>

          <p style="color:#4a6080;font-size:12px;line-height:1.7;margin:0">
            Si no solicitaste este cambio, puedes ignorar este correo. Tu contraseña seguirá siendo la misma.<br><br>
            Por seguridad, <strong style="color:#ef4444">nunca compartas este código</strong> con nadie.
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#080e1e;padding:20px 40px;border-top:1px solid #1a3050;text-align:center">
          <p style="color:#4a6080;font-size:11px;margin:0">
            © ${new Date().getFullYear()} VoteChain Enterprise · Sistema de votación corporativa con blockchain
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return t.sendMail({
    from,
    to,
    subject: `${code} — Tu código de restablecimiento de contraseña · VoteChain`,
    html,
    text: `Hola ${userName},\n\nTu código de restablecimiento es: ${code}\n\nExpira en 15 minutos.\n\nSi no lo solicitaste, ignora este mensaje.`,
  });
}

module.exports = { sendResetCode };
