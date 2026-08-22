import { config } from './config';
import { buildServer } from './server';
import { startWhatsApp } from './whatsapp';

async function bootstrap(): Promise<void> {
  // El HTTP arranca PRIMERO y a propósito: open-wa tarda 30-60s en levantar
  // Chromium, y si Render no ve el health check en ese rato mata el deploy.
  // Además necesitas /qr disponible justo mientras open-wa espera el escaneo.
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
