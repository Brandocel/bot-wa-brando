import { config } from './config';
import { buildServer } from './server';
import { startWhatsApp } from './whatsapp';

async function bootstrap(): Promise<void> {
  // El HTTP arranca PRIMERO y a propósito. Con Baileys la conexión tarda
  // segundos, no el minuto largo que costaba levantar Chromium, pero el
  // orden sigue importando: la primera vez —y cada vez que haya que
  // revincular— /qr tiene que estar sirviendo mientras WhatsApp espera el
  // escaneo, y Render tiene que ver el health check desde el principio.
  const app = buildServer();

  app.listen(config.port, () => {
    console.log(`[http] escuchando en :${config.port}`);
    console.log(`[http] QR en /qr?key=<GATEWAY_API_KEY>`);
  });

  try {
    await startWhatsApp();
  } catch (err) {
    // No hacemos process.exit: si el proceso muere, muere el /qr y te quedas
    // sin forma de recuperar la sesión. Mejor vivo y gritando en los logs.
    console.error('[wa] no pudo arrancar:', err);
  }
}

void bootstrap();
