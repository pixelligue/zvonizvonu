interface Room {
  hostId: string | null;
  peers: Set<string>;
  pending: Map<string, string>;
  screenShareEnabled: boolean;
  recordingAllowed: Set<string>; // peer IDs с разрешением записи
}

const rooms = new Map<string, Room>();

export function generateCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export function createRoom(): string {
  const code = generateCode();
  rooms.set(code, {
    hostId: null,
    peers: new Set(),
    pending: new Map(),
    screenShareEnabled: false,
    recordingAllowed: new Set(),
  });
  return code;
}

export function getRoom(code: string) {
  return rooms.get(code.toUpperCase()) || null;
}

export function setHost(code: string, peerId: string): boolean {
  const room = rooms.get(code.toUpperCase());
  if (!room) return false;
  room.hostId = peerId;
  room.peers.add(peerId);
  room.recordingAllowed.add(peerId); // хост всегда может записывать
  return true;
}

export function requestJoin(code: string, peerId: string, name: string): boolean {
  const room = rooms.get(code.toUpperCase());
  if (!room) return false;
  room.pending.set(peerId, name);
  return true;
}

export function approveJoin(code: string, peerId: string): string[] | null {
  const room = rooms.get(code.toUpperCase());
  if (!room) return null;
  room.pending.delete(peerId);
  room.peers.add(peerId);
  return Array.from(room.peers);
}

export function rejectJoin(code: string, peerId: string): boolean {
  const room = rooms.get(code.toUpperCase());
  if (!room) return false;
  room.pending.delete(peerId);
  return true;
}

export function getPending(code: string): Array<{ peerId: string; name: string }> {
  const room = rooms.get(code.toUpperCase());
  if (!room) return [];
  return Array.from(room.pending.entries()).map(([peerId, name]) => ({ peerId, name }));
}

export function leaveRoom(code: string, peerId: string): void {
  const room = rooms.get(code.toUpperCase());
  if (!room) return;
  room.peers.delete(peerId);
  room.pending.delete(peerId);
  room.recordingAllowed.delete(peerId);
  if (room.hostId === peerId) {
    rooms.delete(code.toUpperCase());
  } else if (room.peers.size === 0) {
    rooms.delete(code.toUpperCase());
  }
}

// Screen share
export function setScreenShare(code: string, enabled: boolean): boolean {
  const room = rooms.get(code.toUpperCase());
  if (!room) return false;
  room.screenShareEnabled = enabled;
  return true;
}

// Recording permissions
export function allowRecording(code: string, peerId: string): boolean {
  const room = rooms.get(code.toUpperCase());
  if (!room) return false;
  room.recordingAllowed.add(peerId);
  return true;
}

export function disallowRecording(code: string, peerId: string): boolean {
  const room = rooms.get(code.toUpperCase());
  if (!room) return false;
  if (room.hostId !== peerId) {
    room.recordingAllowed.delete(peerId);
  }
  return true;
}

export function getRoomSettings(code: string) {
  const room = rooms.get(code.toUpperCase());
  if (!room) return null;
  return {
    screenShareEnabled: room.screenShareEnabled,
    recordingAllowed: Array.from(room.recordingAllowed),
  };
}
