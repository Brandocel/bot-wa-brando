# Conectar Google Drive

Guía operativa. La justificación de las decisiones está en
`docs/ARQUITECTURA-SOPORTE.md` §5.

## 1. Crear la cuenta de servicio

Una cuenta de servicio es un "usuario" que no es una persona. Se usa esta y no
OAuth de usuario por dos razones: no depende de que nadie siga trabajando en la
empresa, y no pide que alguien apruebe una pantalla de consentimiento cada vez
que caduca un token.

1. [Google Cloud Console](https://console.cloud.google.com) → crea un proyecto
   (o usa uno existente).
2. **APIs y servicios → Biblioteca** → busca **Google Drive API** → Habilitar.
   Sin esto, todas las llamadas responden 403 con un mensaje que no dice que
   falta habilitarla.
3. **IAM y administración → Cuentas de servicio → Crear cuenta de servicio**.
   Nombre: `bot-wa-drive`. No hace falta darle ningún rol de IAM: el acceso a
   los archivos no viene de IAM, viene de compartir las carpetas.
4. Entra a la cuenta creada → pestaña **Claves** → **Agregar clave → Crear clave
   nueva → JSON**. Se descarga un archivo.

Ese JSON es una credencial. No va al repositorio.

## 2. Cargar la credencial en Render

El JSON tiene que ir como **una sola línea** en la variable de entorno. Hay un
script que hace la conversión y además te dice qué correo compartir:

```bash
node scripts/dev/drive-env.js ~/Downloads/tu-clave.json
```

Copia la línea que imprime y pégala en Render → `agent-core` → Environment →
`GOOGLE_SERVICE_ACCOUNT_JSON`. Esa línea es una credencial: va del terminal al
panel de Render y a ningún otro lado — ni a un chat, ni a un ticket, ni a un
commit.

Para el `.env` local, la misma línea pero entre **comillas simples**:

```
GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
```

Simples, no dobles. Con comillas dobles, dotenv expande las secuencias de
escape de la llave privada a saltos de línea reales y el JSON deja de ser
válido. El síntoma
es `Expected property name or '}' in JSON at position 4`, que no menciona nada
de comillas.

> Si al arrancar aparece `error:1E08010C:DECODER routines::unsupported`, es la
> llave privada mal escapada. El código ya normaliza el caso común (los saltos
> de línea convertidos en la secuencia literal de dos caracteres), pero un JSON
> partido a mano puede romperse de otras formas. Vuelve a generarlo con el
> comando de arriba.

## 3. Estructura de carpetas en Drive

```
/Flores de Paula/          ← esta carpeta se registra en el bot
   /Facturas/
      FACTURA_2026-02_A1234.pdf
   /Contratos/
   /Reportes/
```

**La organización sale de la carpeta raíz, nunca del nombre del archivo.** Un
archivo llamado `FACTURA_POLLOS_2026-02.pdf` que alguien subió por error a la
carpeta de Flores de Paula pertenece a Flores de Paula. Esa regla es lo que
impide que un nombre mal escrito filtre un documento a otra empresa.

**Nombres de archivo.** El bot necesita deducir *categoría* y *periodo*. Lo que
sí reconoce:

| Nombre | Se indexa como |
|---|---|
| `FACTURA_2026-02_A1234.pdf` | FACTURA · 2026-02 · folio A1234 |
| `factura febrero 2026.pdf` | FACTURA · 2026-02 |
| `CFDI-2026-02-B2001.pdf` | FACTURA · 2026-02 · folio B2001 |
| `reporte_02-2026_ventas.pdf` | REPORTE · 2026-02 |
| `Contrato arrendamiento 2025.pdf` | CONTRATO · 2025 |
| `A1234.pdf` dentro de `/Facturas/` | FACTURA, pero **sin periodo → cuarentena** |
| `escaneo (3).pdf` | **cuarentena** |

Un archivo sin categoría o sin periodo entra en **cuarentena**: existe en el
índice, es visible para el operador con `/cuarentena`, y es invisible para las
búsquedas. Es a propósito. Un documento que el sistema no logró clasificar con
certeza no se entrega, porque el modo de fallo del otro lado —mandar la factura
equivocada— es mucho peor que decir "no lo encontré".

## 4. Compartir y registrar

Por cada empresa:

1. En Drive, clic derecho en la carpeta raíz → **Compartir** → pega el correo de
   la cuenta de servicio (termina en `.iam.gserviceaccount.com`) con permiso de
   **Lector**. Lector, no Editor: si el bot no puede escribir, ningún bug puede
   borrar el Drive del cliente.
2. Copia el id de la carpeta desde su URL:
   `drive.google.com/drive/folders/ESTO_ES_EL_ID`
3. Desde WhatsApp, como dueño:

```
/empresa Flores de Paula | 1a2B3c4D5e6F7g8H
```

4. Dispara la primera sincronización:

```
/sync
```

## 4bis. Comprobar antes de tocar WhatsApp

Con el `.env` local listo:

```bash
npx tsx scripts/dev/verify-drive.ts
```

Comprueba autenticación y que la Drive API esté habilitada. Con el id de una
carpeta comprueba además el acceso y te muestra, archivo por archivo, si se
indexaría o se iría a cuarentena:

```bash
npx tsx scripts/dev/verify-drive.ts <idDeCarpeta>
```

Vale la pena correrlo antes que `/sync`: aquí los errores vienen completos, y
por WhatsApp solo llega el resumen.

## 5. Comandos de operador

| Comando | Para qué |
|---|---|
| `/drive` | Diagnóstico: correo de la cuenta, empresas registradas, última sincronización, conteos |
| `/sync` | Sincroniza ya, sin esperar los 10 minutos |
| `/cuarentena` | Los archivos que Drive tiene y el bot no pudo clasificar. Esta es la lista de tareas del operador |
| `/resync` | Borra el cursor para rehacer el barrido completo |
| `/empresa <nombre> \| <id>` | Da de alta una empresa |

## 6. Cuando "no encuentra nada"

Corre `/drive` primero. En orden de frecuencia:

1. **La carpeta no está compartida** con la cuenta de servicio. Drive no
   devuelve un error: devuelve una carpeta vacía, que es indistinguible de una
   carpeta que de verdad está vacía. Es la causa número uno.
2. **La Drive API no está habilitada** en el proyecto de Google Cloud.
3. **Los archivos están en cuarentena** por nombre. Revisa con `/cuarentena`.
4. **El número que pregunta no tiene permiso.** Recuerda que la respuesta al
   usuario es la misma —"no lo encontré"— tenga o no permiso; el motivo real
   queda en la tabla `AccessAudit`.
