import express from 'express';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { networkInterfaces } from 'node:os';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachSignalingServer } from './signaling.js';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const isProduction = process.argv.includes('--production') || process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? 4173);
const app = express();

app.disable('x-powered-by');
app.use((_request, response, next) => {
  response.setHeader('Permissions-Policy', 'camera=(self), microphone=(self)');
  response.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.get('/healthz', (_request, response) => {
  response.status(200).json({ status: 'ok' });
});

if (isProduction) {
  const clientDist = resolve(root, 'dist');
  app.use(express.static(clientDist, { index: false }));
  app.use((_request, response) => response.sendFile(resolve(clientDist, 'index.html')));
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    root,
    appType: 'spa',
    server: { middlewareMode: true },
  });
  app.use(vite.middlewares);
}

const keyFile = process.env.SSL_KEY_FILE;
const certificateFile = process.env.SSL_CERT_FILE;
const server =
  keyFile && certificateFile
    ? createHttpsServer(
        {
          key: readFileSync(resolve(keyFile)),
          cert: readFileSync(resolve(certificateFile)),
        },
        app,
      )
    : createHttpServer(app);

attachSignalingServer(server);

server.listen(port, '0.0.0.0', () => {
  const protocol = keyFile && certificateFile ? 'https' : 'http';
  console.log(`\n  Lampei Cam está lista:`);
  console.log(`  Local:   ${protocol}://localhost:${port}`);
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) {
        console.log(`  Red:     ${protocol}://${address.address}:${port}`);
      }
    }
  }
  if (protocol === 'http') {
    console.log('\n  Para usar la cámara de un teléfono, publica este puerto con HTTPS.');
    console.log(`  Ejemplo: cloudflared tunnel --url http://localhost:${port}\n`);
  }
});
