import WebSocket from 'ws';

const origin = process.argv[2];
if (!origin) {
  throw new Error('Uso: npm run smoke:deploy -- https://tu-proyecto.vercel.app');
}

const room = `SMOKE${Date.now().toString().slice(-6)}`;
const socketOrigin = origin.replace(/^http/, 'ws').replace(/\/$/, '');
const sockets = [];

function nextMessage(socket, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Tiempo agotado esperando mensaje WebSocket.')), timeoutMs);
    socket.once('message', (raw) => {
      clearTimeout(timeout);
      resolve(JSON.parse(raw.toString()));
    });
    socket.once('error', reject);
  });
}

function connect(role) {
  const socket = new WebSocket(`${socketOrigin}/ws?role=${role}&room=${room}`);
  sockets.push(socket);
  return socket;
}

try {
  const receiver = connect('receiver');
  const receiverWelcome = await nextMessage(receiver);
  if (receiverWelcome.type !== 'welcome') throw new Error('El receptor no recibió welcome.');

  const peerJoined = nextMessage(receiver).catch((error) => ({ type: 'timeout', error: error.message }));
  const sender = connect('sender');
  const senderWelcome = await nextMessage(sender);

  if (!senderWelcome.peers?.includes('receiver')) {
    throw new Error(
      `El transmisor y receptor llegaron a instancias distintas. Sender peers: ${JSON.stringify(senderWelcome.peers)}`,
    );
  }
  const joined = await peerJoined;
  if (joined.type !== 'peer-joined' || joined.role !== 'sender') {
    throw new Error('El receptor no detectó al transmisor.');
  }

  const ready = nextMessage(receiver);
  sender.send(JSON.stringify({ type: 'ready' }));
  const relayed = await ready;
  if (relayed.type !== 'ready') throw new Error('La señal no fue reenviada al receptor.');

  console.log(JSON.stringify({ ok: true, origin, room, relay: relayed.type }, null, 2));
} finally {
  for (const socket of sockets) socket.close();
}
