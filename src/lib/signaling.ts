export type Role = 'sender' | 'receiver';

export type SignalPayload =
  | { description: RTCSessionDescriptionInit }
  | { candidate: RTCIceCandidateInit };

export type ServerMessage =
  | { type: 'welcome'; clientId: string; peers: Role[] }
  | { type: 'peer-joined'; role: Role }
  | { type: 'peer-left'; role: Role }
  | { type: 'ready' }
  | { type: 'signal'; payload: SignalPayload }
  | { type: 'error'; message: string };

type Listener = (message: ServerMessage) => void;
type StateListener = (state: SignalingState) => void;

export type SignalingState = 'connecting' | 'connected' | 'disconnected';

export class SignalingClient {
  private socket?: WebSocket;
  private reconnectTimer?: number;
  private reconnectAttempt = 0;
  private intentionalClose = false;
  private readonly listeners = new Set<Listener>();
  private readonly stateListeners = new Set<StateListener>();

  constructor(
    private readonly role: Role,
    private readonly room: string,
  ) {}

  connect() {
    this.intentionalClose = false;
    this.clearReconnect();
    this.setState('connecting');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = new URL('/ws', `${protocol}//${window.location.host}`);
    url.searchParams.set('role', this.role);
    url.searchParams.set('room', this.room);

    this.socket = new WebSocket(url);
    this.socket.addEventListener('open', () => {
      this.reconnectAttempt = 0;
      this.setState('connected');
    });
    this.socket.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        this.listeners.forEach((listener) => listener(message));
      } catch {
        // Ignore malformed messages from the network.
      }
    });
    this.socket.addEventListener('close', () => {
      this.setState('disconnected');
      if (!this.intentionalClose) {
        this.scheduleReconnect();
      }
    });
  }

  send(message: { type: 'ready' } | { type: 'signal'; payload: SignalPayload }) {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return false;
    }
    this.socket.send(JSON.stringify(message));
    return true;
  }

  onMessage(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onState(listener: StateListener) {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  close() {
    this.intentionalClose = true;
    this.clearReconnect();
    this.socket?.close();
  }

  private setState(state: SignalingState) {
    this.stateListeners.forEach((listener) => listener(state));
  }

  private scheduleReconnect() {
    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, 8000);
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
  }

  private clearReconnect() {
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }
}

export const rtcConfiguration: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
  bundlePolicy: 'max-bundle',
};

