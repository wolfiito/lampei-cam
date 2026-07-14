import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { attachSignalingServer } from './signaling.js';

let server: Server | undefined;
let signaling: ReturnType<typeof attachSignalingServer> | undefined;
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await signaling?.close();
  await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
  server = undefined;
  signaling = undefined;
});

async function start() {
  server = createServer();
  signaling = attachSignalingServer(server);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  return address.port;
}

function connect(port: number, role: 'sender' | 'receiver', room = 'TEST1234', path = '/ws') {
  const socket = new WebSocket(`ws://127.0.0.1:${port}${path}?role=${role}&room=${room}`);
  sockets.push(socket);
  return socket;
}

function nextMessage(socket: WebSocket) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Message timeout')), 2000);
    socket.once('message', (raw) => {
      clearTimeout(timeout);
      resolve(JSON.parse(raw.toString()) as Record<string, unknown>);
    });
    socket.once('error', reject);
  });
}

describe('signaling server', () => {
  it('joins a sender and receiver in the same room', async () => {
    const port = await start();
    const receiver = connect(port, 'receiver');
    expect((await nextMessage(receiver)).type).toBe('welcome');

    const peerJoined = nextMessage(receiver);
    const sender = connect(port, 'sender');
    const senderWelcome = await nextMessage(sender);

    expect(senderWelcome).toMatchObject({ type: 'welcome', peers: ['receiver'] });
    expect(await peerJoined).toMatchObject({ type: 'peer-joined', role: 'sender' });
  });

  it('relays WebRTC messages only to the paired peer', async () => {
    const port = await start();
    const receiver = connect(port, 'receiver');
    await nextMessage(receiver);
    const peerJoined = nextMessage(receiver);
    const sender = connect(port, 'sender');
    await nextMessage(sender);
    await peerJoined;

    const ready = nextMessage(receiver);
    sender.send(JSON.stringify({ type: 'ready' }));
    expect(await ready).toEqual({ type: 'ready' });

    const answer = nextMessage(sender);
    receiver.send(
      JSON.stringify({ type: 'signal', payload: { description: { type: 'offer', sdp: 'test-sdp' } } }),
    );
    expect(await answer).toMatchObject({
      type: 'signal',
      payload: { description: { type: 'offer', sdp: 'test-sdp' } },
    });
  });

  it('accepts the Vercel function path', async () => {
    const port = await start();
    const receiver = connect(port, 'receiver', 'VERCEL01', '/api/ws');

    expect(await nextMessage(receiver)).toMatchObject({ type: 'welcome', peers: [] });
  });
});
