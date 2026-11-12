export const LIMITS = {
  message: 768 * 1024, room: 8 * 1024 * 1024, image: 512 * 1024,
  rate: 80, burst: 160, bytesPerSecond: 4 * 1024 * 1024,
  roomConnections: 32, accountConnections: 256, userConnections: 8,
  subscriptions: 24, players: 16, ttl: 24 * 60 * 60 * 1000,
  accountIPConnections: 16, ipConnectionsPerMinute: 120, ipRoomAttemptsPerMinute: 90,
  accounts: 10000, accountsPerIP: 32, accountTTL: 30 * 24 * 60 * 60 * 1000,
  idle: 15 * 60 * 1000, connectionTTL: 24 * 60 * 60 * 1000,
  activeRooms: 512, ticketTTL: 30000, reservationTTL: 120000,
  outgoingRate: 2 * 1024 * 1024, outgoingBurst: 10 * 1024 * 1024,
  roomOutgoingRate: 16 * 1024 * 1024, roomOutgoingBurst: 32 * 1024 * 1024,
};
export const bytes = (v: string) => new TextEncoder().encode(v).byteLength;
export function assert(ok: unknown, code = 'forbidden'): asserts ok { if (!ok) throw new Error(code); }
export function plain(v: unknown): v is Record<string, any> { return !!v && typeof v === 'object' && !Array.isArray(v); }
export function parts(path: unknown): string[] {
  assert(typeof path === 'string' && path.length <= 256, 'invalid_path');
  const p = path.split('/');
  assert(p.every(s => s.length > 0 && !['__proto__', 'prototype', 'constructor'].includes(s) && !/[.#$\[\]\x00-\x1f]/.test(s)), 'invalid_path');
  return p;
}
export function read(root: any, path: string[]) { let v = root; for (const p of path) v = v?.[p]; return v ?? null; }
export function write(root: any, path: string[], value: any) {
  if (!path.length) return value;
  let node = root;
  path.slice(0, -1).forEach(p => { if (!node[p] || typeof node[p] !== 'object') node[p] = {}; node = node[p]; });
  const last = path[path.length - 1];
  if (value === null) delete node[last]; else node[last] = value;
  return root;
}
export interface Attachment {
  uid?: string; authenticatedAt?: number; opened: number; subs: Record<string, string>;
  tokens: number; tick: number; traffic: number; trafficTick: number; violations: number;
  disconnect?: Record<string, any>;
  ip?: string; lastAction?: number; confirmed?: boolean;
  out?: Bucket;
}
export interface Bucket { tokens: number; tick: number }
export function take(bucket: Bucket, size: number, rate: number, burst: number) {
  const now = Date.now(); bucket.tokens = Math.min(burst, bucket.tokens + Math.max(0, now - bucket.tick) * rate / 1000); bucket.tick = now;
  if (bucket.tokens < size) return false;
  bucket.tokens -= size; return true;
}
export function boundedSend(ws: WebSocket, value: any, a: Attachment, room?: Bucket) {
  const data = JSON.stringify(value), size = bytes(data);
  a.out ||= { tokens: LIMITS.outgoingBurst, tick: Date.now() };
  if (!take(a.out, size, LIMITS.outgoingRate, LIMITS.outgoingBurst) || room && !take(room, size, LIMITS.roomOutgoingRate, LIMITS.roomOutgoingBurst)) {
    try { ws.close(1008, 'send_rate_limited'); } catch {} return false;
  }
  try { ws.send(data); } catch {} ws.serializeAttachment(a); return true;
}
export function saveAttachment(ws: WebSocket, a: Attachment) {
  // New frames may arrive while an authenticated operation awaits an internal RPC.
  const current = ws.deserializeAttachment() as Attachment;
  for (const field of ['tokens', 'tick', 'traffic', 'trafficTick'] as const) a[field] = current[field];
  a.lastAction = Math.max(a.lastAction || 0, current.lastAction || 0);
  ws.serializeAttachment(a);
}
export function subscription(a: Attachment, sub: unknown, path: string) {
  assert(typeof sub === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(sub) && !['__proto__', 'constructor', 'prototype'].includes(sub), 'invalid_subscription');
  assert(!Object.entries(a.subs).some(([key, value]) => key !== sub && value === path), 'duplicate_subscription');
  assert(Object.hasOwn(a.subs, sub) ? a.subs[sub] === path : Object.keys(a.subs).length < LIMITS.subscriptions, 'subscriptions_full');
  a.subs[sub] = path;
}
export function attachment(): Attachment { return { opened: Date.now(), subs: {}, tokens: LIMITS.burst, tick: Date.now(), traffic: 0, trafficTick: Date.now(), violations: 0 }; }
export function parse(data: string | ArrayBuffer, a: Attachment): any {
  assert(typeof data === 'string', 'text_only');
  const size = bytes(data);
  assert(size <= LIMITS.message, 'message_too_large');
  const now = Date.now();
  a.tokens = Math.min(LIMITS.burst, a.tokens + (now - a.tick) * LIMITS.rate / 1000); a.tick = now;
  if (now - a.trafficTick >= 1000) { a.traffic = 0; a.trafficTick = now; }
  a.traffic += size;
  assert(a.tokens >= 1 && a.traffic <= LIMITS.bytesPerSecond, 'rate_limited'); a.tokens--;
  const m = JSON.parse(data);
  assert(plain(m) && Number.isSafeInteger(m.id) && m.id >= 0 && typeof m.op === 'string', 'invalid_message');
  return m;
}
export function send(ws: WebSocket, data: any) { try { ws.send(JSON.stringify(data)); } catch {} }
export function fail(ws: WebSocket, id: any, error: unknown) {
  const code = error instanceof Error ? error.message : 'invalid_message';
  send(ws, { id: Number.isSafeInteger(id) ? id : null, error: code });
  if (['message_too_large', 'rate_limited'].includes(code)) { try { ws.close(1008, code); } catch {} }
}
