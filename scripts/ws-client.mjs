import WebSocket from 'ws';
export const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
export class Client {
    constructor(socket) {
        this.socket = socket; this.seq = 0; this.pending = new Map(); this.events = [];
        socket.on('error', () => {});
        socket.on('message', raw => {
            const m = JSON.parse(raw.toString());
            if (m.sub) { this.events.push(m); return; }
            const p = this.pending.get(m.id); if (!p) return;
            clearTimeout(p.timer); this.pending.delete(m.id);
            m.error ? p.reject(new Error(m.error)) : p.resolve(m.value);
        });
        socket.on('close', (code, reason) => {
            for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error(reason.toString() || `closed:${code}`)); }
            this.pending.clear();
        });
    }
    static async open(game, room, origin = new URL(BASE).origin, base = BASE) {
        const url = new URL('/ws', base); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        if (game) { url.searchParams.set('game', game); url.searchParams.set('room', room); }
        const socket = new WebSocket(url, { origin });
        await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
        return new Client(socket);
    }
    request(op, args = {}) {
        const id = ++this.seq;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`timeout: ${op}`)); }, 10000);
            this.pending.set(id, { resolve, reject, timer });
            this.socket.send(JSON.stringify({ id, op, ...args }));
        });
    }
    async auth(identity) { return this.request('auth', identity ? { uid: identity.uid, token: identity.token } : {}); }
    close() { this.socket.close(); }
}
export async function until(fn, label) {
    const end = Date.now() + 10000;
    while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 25)); }
    throw new Error(`timeout: ${label}`);
}
