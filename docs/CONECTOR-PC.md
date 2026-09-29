# Conector de PC

Para clientes que guardan sus documentos en su computadora y no en Drive.

## Cómo funciona

El conector vive en la PC del cliente, vigila una carpeta y **sube** al bot lo
nuevo, lo modificado y lo borrado. El bot nunca se conecta a la PC: no hay
puertos que abrir, y el bot sigue entregando documentos aunque la PC esté
apagada, porque los archivos quedan guardados en Postgres (`StoredFile`).

Los archivos subidos pasan por el mismo parser y la misma lectura de contenido
que los de Drive. Sus ids llevan el prefijo `pc:`; `RoutingDocumentSource`
decide de dónde bajar cada uno.

## Conectar un cliente

1. Panel → **Empresas** → crear la empresa con origen **Su computadora**, o
   cambiar el origen de una existente. Pulsar **Conectar PC**: sale un código
   de 6 dígitos que vale 15 minutos y sirve una sola vez.
2. En la PC del cliente (necesita Node 20+ por ahora):

   ```bash
   node conector.mjs --instalar
   ```

   Pide la dirección del bot, el código y abre el selector de carpetas de
   Windows. `--instalar` además lo deja arrancando solo al prender Windows,
   sin ventana.
3. En el panel, la fila de la empresa pasa a **en línea** con el número de
   archivos y la última subida.

Variables opcionales: `CONECTOR_SERVER` (dirección del bot por defecto) y
`CONECTOR_CARPETA` (carpeta sin abrir el selector, para instalar por script).

## Operación

- **Latido:** el conector revisa la carpeta completa cada 5 minutos, además de
  reaccionar a los cambios en segundos. Si pasan más de 30 minutos sin
  noticias, el panel muestra **apagada**.
- **Desconectar un equipo:** botón × junto al nombre del equipo en el panel.
  El conector se detiene solo en su siguiente vuelta. Lo ya subido se queda.
- **Cambiar de empresa o de carpeta:** `node conector.mjs --olvidar` y volver
  a conectarlo con un código nuevo.
- **Registro:** `%APPDATA%\ConectorBot\conector.log`.
- **Límites:** 25 MB por archivo. Solo tipos entregables (PDF, imágenes,
  Office, TXT y CSV). Se ignoran los archivos ocultos, los de bloqueo de
  Office (`~$…`) y los temporales.

## Salvaguardas

- Si la carpeta desaparece (disco externo desconectado, unidad de red caída),
  el conector no manda nada. Un manifiesto vacío le diría al bot que se borró
  todo.
- Un archivo abierto en exclusiva por otro programa conserva su huella
  anterior. No se da por borrado.
- El token del equipo se guarda hasheado. Emparejar tiene un freno de 10
  intentos fallidos por IP cada 15 minutos.

## Capacidad

Todo va en la base de datos de Render. Vigila su tamaño. Cuando crezca, el
contenido se puede mover a R2 o al NAS cambiando solo `RoutingDocumentSource`
y `ConnectorService`; el conector no cambia.
