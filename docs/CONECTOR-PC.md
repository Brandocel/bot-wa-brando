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

El cliente no instala nada ni teclea nada.

1. Panel → **Empresas** → crear la empresa con origen **Su computadora** (o
   cambiar el origen de una existente) → **Conectar PC** → **Descargar
   conector**.
2. Ese `ConectorBot-<Empresa>.exe` trae adentro la dirección del bot y un
   código de un solo uso que vale 3 días. Se abre en la PC del cliente, o se
   le manda por correo o WhatsApp.
3. Doble clic → se elige la carpeta en la ventana de Windows → listo. El
   conector se copia a `%LOCALAPPDATA%\ConectorBot`, se registra para
   arrancar con Windows sin ventana y empieza a subir.
4. En el panel, la fila pasa a **en línea** con el número de archivos.

Un segundo doble clic solo avisa que ya está funcionando. Cada descarga sirve
para una computadora; para otra PC, se descarga otra vez.

**SmartScreen:** el .exe no está firmado, así que Windows puede mostrar
"Windows protegió su PC". Se pulsa *Más información → Ejecutar de todas
formas*. Para quitar el aviso hace falta un certificado de firma de código.

**Plan B sin descarga:** en la misma tarjeta, *Usa un código* genera un código
de 15 minutos para un conector que ya esté en la PC.

### Cómo se arma el .exe

`apps/pc-connector/build-exe.cjs` corre en el build de Render. Empaqueta
`conector.cjs` como ejecutable único de Node (SEA) sobre el `node.exe` de
Windows de la misma versión, bajado de nodejs.org. El panel lo sirve con la
configuración pegada al final del archivo. Si el build del .exe falla, el
deploy sigue y el botón responde "no disponible".

Localmente: `npm run build:conector` deja `apps/pc-connector/dist/ConectorBot.exe`.
Para desarrollo sin .exe: `npm run conector` (pide dirección y código).

Variables opcionales: `CONECTOR_SERVER` (dirección por defecto en modo script),
`CONECTOR_CARPETA` (carpeta sin abrir la ventana) y, en el servidor,
`CONNECTOR_EXE_PATH`.

## Operación

- **Latido:** el conector revisa la carpeta completa cada 5 minutos, además de
  reaccionar a los cambios en segundos. Si pasan más de 30 minutos sin
  noticias, el panel muestra **apagada**.
- **Desconectar un equipo:** botón × junto al nombre del equipo en el panel.
  El conector se detiene solo en su siguiente vuelta. Lo ya subido se queda.
- **Cambiar de empresa o de carpeta:** `ConectorBot.exe --olvidar` (o
  desconectar el equipo en el panel) y abrir un instalador nuevo.
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
