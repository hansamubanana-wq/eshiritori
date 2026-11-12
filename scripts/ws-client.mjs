import WebSocket from 'ws';
export const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
export class Client {
    constructor(socket) {
        this.socket = socket; this.seq = 0; this.pending = new Map(); this.events = []; this.subs = new Map(); this.frames = [];
        socket.on('error', () => {});
        socket.on('message', raw => {
            const m = JSON.parse(raw.toString());
            this.frames.push(m);
            if (m.patches) {
                for (const sub of m.subs) {
                    const entry = this.subs.get(sub); if (!entry) continue;
                    for (const [path, value] of m.patches) {
                        if (!path.slice(0, Math.min(path.length, entry.path.length)).every((p, i) => p === entry.path[i])) continue;
                        if (path.length <= entry.path.length) { entry.value = structuredClone(value); for (const key of entry.path.slice(path.length)) entry.value = entry.value?.[key] ?? null; }
                        else {
                            let node = entry.value;
                            for (const key of path.slice(entry.path.length, -1)) { node[key] ??= {}; node = node[key]; }
                            if (value === null) delete node[path.at(-1)]; else node[path.at(-1)] = structuredClone(value);
                        }
                    }
                    this.events.push({ sub, value: structuredClone(entry.value) });
                }
                return;
            }
            if (m.sub) { this.events.push(m); return; }
            const p = this.pending.get(m.id); if (!p) return;
            clearTimeout(p.timer); this.pending.delete(m.id);
            if (!m.error && p.op === 'subscribe') this.subs.set(p.args.sub, { path: p.args.path.split('/').slice(2), value: structuredClone(m.value) });
            m.error ? p.reject(new Error(m.error)) : p.resolve(m.value);
        });
        socket.on('close', (code, reason) => {
            for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error(reason.toString() || `closed:${code}`)); }
            this.pending.clear();
        });
    }
    static async open(game, room, origin = new URL(BASE).origin, base = BASE, options = {}) {
        const url = new URL('/ws', base); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        if (game) { url.searchParams.set('game', game); url.searchParams.set('room', room); }
        let ticket = options.ticket;
        if (game && options.identity) {
            const account = options.account || await Client.open(undefined, undefined, origin, base, { ip: options.ip });
            try {
                if (!options.account) await account.auth(options.identity);
                ticket = await account.request('roomTicket', { game, room });
            } finally { if (!options.account) account.close(); }
        }
        if (ticket) url.searchParams.set('ticket', ticket);
        const socket = new WebSocket(url, { origin, headers: options.ip ? { 'CF-Connecting-IP': options.ip } : {} });
        await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
        return new Client(socket);
    }
    request(op, args = {}) {
        const id = ++this.seq;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`timeout: ${op}`)); }, 10000);
            this.pending.set(id, { resolve, reject, timer, op, args });
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
