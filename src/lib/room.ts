const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function createRoomCode(length = 8) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('');
}

export function getRoomFromUrl() {
  return new URLSearchParams(window.location.search).get('room')?.toUpperCase() ?? '';
}

export function isValidRoom(room: string) {
  return /^[A-Z0-9]{6,12}$/.test(room);
}

export function roomUrl(path: '/sender' | '/receiver', room: string) {
  const url = new URL(path, window.location.origin);
  url.searchParams.set('room', room);
  return url.toString();
}

