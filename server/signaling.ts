import { randomUUID } from 'node:crypto';
import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import { WebSocket, WebSocketServer } from 'ws';

type Role = 'sender' | 'receiver';
type Client = { id: string; role: Role; room: string; socket: WebSocket; alive: boolean };
type Room = Partial<Record<Role, Client>>;

type ClientMessage =
  | { type: 'ready' }
  | {
      type: 'signal';
      payload:
        | { description: { type: string; sdp?: string } }
        | { candidate: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null } };
    };

const ROOM_PATTERN = /^[A-Z0-9]{6,12}$/;
const WEBSOCKET_PATHS = new Set(['/ws', '/api/ws']);

function send(socket: WebSocket, message: object) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function parseIdentity(request: IncomingMessage) {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const role = url.searchParams.get('role');
  const room = url.searchParams.get('room')?.toUpperCase();

  if ((role !== 'sender' && role !== 'receiver') || !room || !ROOM_PATTERN.test(room)) {
    return null;
  }

  return { role, room } satisfies { role: Role; room: string };
}

export function attachSignalingServer(server: HttpServer | HttpsServer) {
  const rooms = new Map<string, Room>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  const onUpgrade = (request: IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (!WEBSOCKET_PATHS.has(url.pathname)) return;

    const identity = parseIdentity(request);
    if (!identity) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (webSocket) => {
      wss.emit('connection', webSocket, request, identity);
    });
  };

  server.on('upgrade', onUpgrade);

  wss.on('connection', (socket: WebSocket, _request: IncomingMessage, identity: { role: Role; room: string }) => {
    const client: Client = { id: randomUUID(), ...identity, socket, alive: true };
    const room = rooms.get(identity.room) ?? {};
    const previous = room[identity.role];
    if (previous && previous.socket !== socket) {
      previous.socket.close(4001, 'Replaced by a newer connection');
    }
    room[identity.role] = client;
    rooms.set(identity.room, room);

    const oppositeRole: Role = identity.role === 'sender' ? 'receiver' : 'sender';
    const peer = room[oppositeRole];
    send(socket, {
      type: 'welcome',
      clientId: client.id,
      peers: peer ? [oppositeRole] : [],
    });
    if (peer) send(peer.socket, { type: 'peer-joined', role: identity.role });

    socket.on('pong', () => {
      client.alive = true;
    });

    socket.on('message', (raw) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        send(socket, { type: 'error', message: 'Mensaje inválido.' });
        return;
      }

      if (message.type !== 'ready' && message.type !== 'signal') {
        send(socket, { type: 'error', message: 'Tipo de mensaje no permitido.' });
        return;
      }

      const currentRoom = rooms.get(identity.room);
      const currentPeer = currentRoom?.[oppositeRole];
      if (currentPeer) send(currentPeer.socket, message);
    });

    socket.on('close', () => {
      const currentRoom = rooms.get(identity.room);
      if (!currentRoom || currentRoom[identity.role]?.id !== client.id) return;
      delete currentRoom[identity.role];
      const currentPeer = currentRoom[oppositeRole];
      if (currentPeer) send(currentPeer.socket, { type: 'peer-left', role: identity.role });
      if (!currentRoom.sender && !currentRoom.receiver) rooms.delete(identity.room);
    });
  });

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      const client = [...rooms.values()]
        .flatMap((room) => [room.sender, room.receiver])
        .find((candidate) => candidate?.socket === socket);
      if (client && !client.alive) {
        socket.terminate();
        continue;
      }
      if (client) client.alive = false;
      socket.ping();
    }
  }, 30_000);
  heartbeat.unref();

  return {
    async close() {
      clearInterval(heartbeat);
      server.off('upgrade', onUpgrade);
      for (const socket of wss.clients) socket.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}
