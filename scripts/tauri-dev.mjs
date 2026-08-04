import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const host = '127.0.0.1';
const defaultPort = 17420;
const maxPortAttempts = 40;
const requestedPort = Number.parseInt(
  process.env.BETTER_EMAIL_DEV_PORT ?? process.env.PORT ?? String(defaultPort),
  10,
);
const startPort = Number.isFinite(requestedPort) && requestedPort > 0
  ? requestedPort
  : defaultPort;

function canListen(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen({ host, port });
  });
}

async function findDevPort() {
  for (let offset = 0; offset < maxPortAttempts; offset += 1) {
    const port = startPort + offset;
    if (await canListen(port)) return port;
  }
  throw new Error(`No free dev port found from ${startPort} to ${startPort + maxPortAttempts - 1}`);
}

const port = await findDevPort();
const devUrl = `http://${host}:${port}`;
const beforeDevCommand = `npm run dev -- --host ${host} --port ${port} --strictPort`;
const config = {
  build: {
    devUrl,
    beforeDevCommand,
  },
};

if (port !== startPort) {
  console.log(`[tauri-dev] Port ${startPort} is busy, using ${port} instead.`);
} else {
  console.log(`[tauri-dev] Using ${devUrl}.`);
}

if (process.env.BETTER_EMAIL_TAURI_DEV_DRY_RUN === '1') {
  console.log(JSON.stringify({ port, devUrl, beforeDevCommand }, null, 2));
  process.exit(0);
}

const child = spawn(
  'cargo',
  ['tauri', 'dev', '--config', JSON.stringify(config), ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      BETTER_EMAIL_DEV_PORT: String(port),
      VITE_DEV_SERVER_URL: devUrl,
    },
  },
);

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
