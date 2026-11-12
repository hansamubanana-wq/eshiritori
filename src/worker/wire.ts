export const LIMITS = {
  message: 768 * 1024, room: 8 * 1024 * 1024, image: 512 * 1024,
  rate: 80, burst: 160, bytesPerSecond: 4 * 1024 * 1024,
  roomConnections: 32, accountConnections: 256, userConnections: 8,
  subscriptions: 24, players: 16, ttl: 24 * 60 * 60 * 1000,
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
