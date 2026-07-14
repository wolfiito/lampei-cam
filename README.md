# Lampei Cam

PWA para usar la cámara y el micrófono de un iPhone o Android como fuente inalámbrica de baja latencia en OBS Studio.

## Arquitectura del MVP

```text
iPhone / Android (PWA) ── WebRTC punto a punto ── OBS (Fuente de navegador)
              │                                      │
              └──── WebSocket de señalización ───────┘
```

El navegador móvil no puede publicar NDI nativo. Este MVP entra directamente a OBS mediante su Fuente de navegador, sin instalar el plugin NDI. La capa de señalización solo intercambia los datos necesarios para conectar ambos extremos; el video y el audio viajan por WebRTC.

## Requisitos

- Node.js 20 o posterior
- pnpm
- OBS Studio con Fuente de navegador
- iPhone/Android y PC conectados preferentemente al mismo Wi-Fi de 5 GHz
- Una URL HTTPS para abrir la cámara desde el teléfono

## Desarrollo local

```powershell
pnpm install
pnpm dev
```

Abre `http://localhost:4173` en la PC. `localhost` cuenta como contexto seguro y permite probar una cámara conectada a la PC.

### Abrir desde el teléfono con HTTPS

La cámara del navegador exige HTTPS cuando se accede desde otro dispositivo. La forma rápida para el MVP es un túnel temporal de Cloudflare:

```powershell
winget install Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:4173
```

Abre en la PC la URL `https://...trycloudflare.com` que aparece en la terminal. Desde esa pantalla:

1. Escanea el QR con el teléfono.
2. Toca **Iniciar cámara** y permite cámara/micrófono.
3. En OBS crea **Fuente de navegador**.
4. Pega el enlace de OBS que muestra la página.
5. Configura ancho `1920`, alto `1080` y FPS `30`.
6. Deja desactivada la opción **Cerrar fuente cuando no sea visible** para evitar reconexiones al cambiar de escena.

El túnel transporta la página y la señalización cifrada. Siempre que la red lo permita, el audio/video WebRTC viaja directamente entre teléfono y PC.

## HTTPS local opcional

El servidor admite un certificado propio mediante variables de entorno:

```powershell
$env:SSL_KEY_FILE = "C:\ruta\local-key.pem"
$env:SSL_CERT_FILE = "C:\ruta\local-cert.pem"
pnpm dev
```

El certificado debe ser de confianza para el teléfono y contener como nombre alternativo la IP o nombre local de la PC.

## Preview en Vercel

El repositorio incluye `vercel.json` y un endpoint WebSocket en `api/ws.ts`. Desde Bash:

```bash
npx vercel login
npx vercel
```

Acepta los valores predeterminados cuando la CLI pregunte por el proyecto. El último comando devuelve una URL HTTPS de preview que puedes abrir en la PC, escanear desde el teléfono y pegar en OBS.

Los WebSockets de Vercel están en beta y cada conexión permanece ligada a una Function. Esta versión guarda las salas en memoria, así que sirve como smoke test de una sola cámara; para producción se debe externalizar la coordinación de salas y pub/sub.

## Despliegue recomendado en Render

Render ejecuta el servidor Express y el WebSocket en un proceso persistente, por lo que las salas en memoria funcionan correctamente mientras el servicio tenga una sola instancia. El archivo `render.yaml` deja configurados el build, el arranque y la comprobación de salud.

1. Publica este proyecto en un repositorio de GitHub, GitLab o Bitbucket.
2. En Render elige **New > Blueprint** y conecta el repositorio.
3. Confirma el servicio `lampei-cam` del archivo `render.yaml`.
4. Espera a que termine el primer despliegue y abre la URL `https://lampei-cam-....onrender.com`.
5. Usa esa misma URL HTTPS en la PC, el teléfono y la Fuente de navegador de OBS.

El plan gratuito puede suspender el servicio tras un periodo sin actividad. La primera apertura después de esa pausa tardará más, pero la aplicación volverá a conectar el WebSocket automáticamente. Si posteriormente se ejecutan varias instancias, será necesario mover las salas a Redis o a otro sistema compartido.

## Validación

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

## Alcance actual

- Una cámara y un receptor por sesión.
- Cámara frontal/trasera, audio activable y resolución ideal de 1080p/30.
- Reconexión de señalización automática.
- Instalable como PWA.
- Entrada directa en OBS mediante Fuente de navegador.

Para exponer la cámara como una fuente NDI descubrible por otras aplicaciones se necesita una segunda etapa: un puente de escritorio que reciba WebRTC y publique con el NDI SDK nativo.
