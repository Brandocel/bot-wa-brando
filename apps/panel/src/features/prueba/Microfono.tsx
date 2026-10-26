import { Mic, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export interface AudioGrabado {
  /** Data URI completo. */
  base64: string;
  mimetype: string;
}

/**
 * Grabar una nota de voz en el navegador, como la mandaría el cliente por
 * WhatsApp. Un clic empieza, otro termina y la manda.
 */
export function Microfono({ onAudio, disabled }: { onAudio: (a: AudioGrabado) => void; disabled?: boolean }) {
  const [grabando, setGrabando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const grabadora = useRef<MediaRecorder | null>(null);

  useEffect(() => {
    if (!grabando) return;
    const t = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [grabando]);

  // Si se sale de la página grabando, se suelta el micrófono.
  useEffect(() => () => grabadora.current?.stream.getTracks().forEach((t) => t.stop()), []);

  async function empezar() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const tipo = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported(t));
      const rec = new MediaRecorder(stream, tipo ? { mimeType: tipo } : undefined);
      const trozos: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size > 0 && trozos.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(trozos, { type: rec.mimeType || 'audio/webm' });
        if (blob.size === 0) return;
        const lector = new FileReader();
        lector.onload = () => onAudio({ base64: String(lector.result), mimetype: blob.type.split(';')[0] || 'audio/webm' });
        lector.readAsDataURL(blob);
      };
      grabadora.current = rec;
      rec.start();
      setSegundos(0);
      setGrabando(true);
    } catch {
      toast.error('No se pudo usar el micrófono. Revisa el permiso del navegador.');
    }
  }

  function terminar() {
    grabadora.current?.stop();
    grabadora.current = null;
    setGrabando(false);
  }

  return grabando ? (
    <Button type="button" variant="danger-soft" onClick={terminar} aria-label="Terminar y enviar el audio">
      <Square />
      <span className="tabular-nums">0:{String(segundos).padStart(2, '0')}</span>
    </Button>
  ) : (
    <Button type="button" variant="secondary" onClick={empezar} disabled={disabled} aria-label="Grabar una nota de voz">
      <Mic />
    </Button>
  );
}
