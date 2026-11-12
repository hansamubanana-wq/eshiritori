// Small compatibility layer. The Worker authenticates, validates and commits every write.
export const db = Object.freeze({});
export const getDatabase = () => db;
export const ref = (_db, path = '') => ({ path, key: path.split('/').at(-1) });
export const onReady = fn => document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', fn, { once: true }) : queueMicrotask(fn);
const snapshot = value => ({ val: () => structuredClone(value ?? null), exists: () => value !== null && value !== undefined });
const roomTypes = new Set(['rooms', 'rooms-quiz', 'rooms-telephone', 'word-wolf-rooms', 'typing-race-rooms', 'quiz-battle-rooms', 'memory-card-rooms']);
let identity;
let sequence = 0;

class Connection {
    constructor(game, room, defer = false) {
        this.game = game; this.room = room; this.pending = new Map(); this.subs = new Map(); this.retry = 250;
        if (!defer) this.connected = this.open();
    }
    async open() {
        const credentials = this.game ? await ready : identity;
        const ticket = this.game ? await accounts.send({ op: 'roomTicket', game: this.game, room: this.room }) : null;
        return new Promise((resolve, reject) => {
            const url = new URL('/ws', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
            if (this.game) { url.searchParams.set('game', this.game); url.searchParams.set('room', this.room); url.searchParams.set('ticket', ticket); }
            const ws = this.ws = new WebSocket(url);
            let authenticated = false;
            ws.onopen = async () => {
                try {
                    let auth;
                    try { auth = await this.raw({ op: 'auth', ...(credentials ? { uid: credentials.uid, token: credentials.token } : {}) }); }
                    catch (error) {
                        if (this.game || error.message !== 'invalid_credentials') throw error;
                        auth = await this.raw({ op: 'auth' });
                    }
                    if (!this.game) {
                        identity = auth;
                        localStorage.setItem('eshiritori.identity', JSON.stringify(auth));
                        localStorage.setItem('userId', auth.uid);
                        localStorage.setItem('friendCode', auth.friendCode);
                    }
                    authenticated = true; this.hasAuthenticated = true; this.retry = 250;
                    for (const [sub, entry] of this.subs) this.raw({ op: 'subscribe', path: entry.path, sub }).then(entry.deliver).catch(entry.error);
                    resolve(this.game ? credentials : auth);
                } catch (error) { reject(error); ws.close(1008, 'authentication_failed'); }
            };
            ws.onmessage = event => {
                if (event.data === 'pong') return;
                const message = JSON.parse(event.data);
                if (message.patches) {
                    for (const sub of message.subs) {
                        const entry = this.subs.get(sub); if (!entry) continue;
                        let value = structuredClone(entry.current);
                        const base = entry.path.split('/').slice(2);
                        for (const [path, next] of message.patches) {
                            if (!path.slice(0, Math.min(path.length, base.length)).every((p, i) => p === base[i])) continue;
                            if (path.length <= base.length) { value = next; for (const key of base.slice(path.length)) value = value?.[key] ?? null; }
                            else value = apply(value, path.slice(base.length), next);
                        }
                        entry.deliver(value);
                    }
                } else if (message.sub) {
                    const entry = this.subs.get(message.sub);
                    if (entry) message.error ? entry.error(new Error(message.error)) : entry.deliver(message.value);
                } else {
                    const pending = this.pending.get(message.id); if (!pending) return;
                    this.pending.delete(message.id); clearTimeout(pending.timeout);
                    message.error ? pending.reject(new Error(message.error)) : pending.resolve(message.value);
                }
            };
            ws.onclose = event => {
                for (const p of this.pending.values()) { clearTimeout(p.timeout); p.reject(new Error('connection_closed')); }
                this.pending.clear();
                if (!authenticated) reject(new Error('connection_failed'));
                if (this.hasAuthenticated && ![1008, 4001, 4002].includes(event.code)) {
                    this.connected = new Promise((res, rej) => setTimeout(() => this.open().then(res, rej), this.retry));
                    this.connected.catch(report); this.retry = Math.min(this.retry * 2, 10000);
                }
                if (event.code === 4001) report(new Error('room_expired'));
                if (event.code === 4002) {
                    this.idle = true;
                    const resume = () => { if (!this.idle) return; this.idle = false; this.connected = this.open(); this.connected.catch(report); };
                    window.addEventListener('pointerdown', resume, { once: true }); window.addEventListener('keydown', resume, { once: true });
                }
            };
            ws.onerror = () => {};
        });
    }
    raw(payload) {
        return new Promise((resolve, reject) => {
            if (this.ws.readyState !== WebSocket.OPEN) { reject(new Error('connection_closed')); return; }
            const id = ++sequence;
            const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error('request_timeout')); }, 15000);
            this.pending.set(id, { resolve, reject, timeout });
            this.ws.send(JSON.stringify({ ...payload, id }));
        });
    }
    async send(payload) { if (this.idle) throw new Error('connection_expired'); await this.connected; return this.raw(payload); }
}
function apply(root, path, value) {
    if (!path.length) return structuredClone(value);
    root ??= {};
    let node = root;
    for (const key of path.slice(0, -1)) { if (!node[key] || typeof node[key] !== 'object') node[key] = {}; node = node[key]; }
    if (value === null) delete node[path.at(-1)]; else node[path.at(-1)] = structuredClone(value);
    return root;
}

function report(error) {
    window.dispatchEvent(new CustomEvent('syncerror', { detail: error }));
}
const accounts = new Connection(undefined, undefined, true);
const initialize = () => {
    try { identity = JSON.parse(localStorage.getItem('eshiritori.identity')); } catch {}
    return accounts.open();
};
// Serialize the first identity allocation across tabs sharing this origin.
export const ready = navigator.locks ? navigator.locks.request('eshiritori-identity', initialize) : initialize();
accounts.connected = ready;
const rooms = new Map();
function connection(path, value) {
    const target = path || Object.keys(value || {})[0] || '';
    const [game, room] = target.split('/');
    if (roomTypes.has(game) && room) {
        const key = `${game}/${room}`;
        if (!rooms.has(key)) rooms.set(key, new Connection(game, room));
        return rooms.get(key);
    }
    return accounts;
}
export async function get(r) { return snapshot(await connection(r.path).send({ op: 'get', path: r.path })); }
export function set(r, value) { return connection(r.path).send({ op: 'set', path: r.path, value }); }
export function update(r, value) {
    // A completed drawing is append-only; do not resend every earlier PNG on each turn.
    if (Array.isArray(value.gameData) && value.gameData.length) {
        const index = value.gameData.length - 1;
        value = { ...value, [`gameData/${index}`]: value.gameData[index] }; delete value.gameData;
    }
    return connection(r.path, value).send({ op: 'update', path: r.path, value });
}
export function remove(r) { return connection(r.path).send({ op: 'remove', path: r.path }); }
export function push(r, value) {
    const next = ref(db, `${r.path}/k_${crypto.randomUUID().replaceAll('-', '')}`);
    return value === undefined ? next : Object.assign(set(next, value).then(() => next), next);
}
export function onValue(r, callback, error = report) {
    const c = connection(r.path), sub = `s${++sequence}`;
    let entry;
    // open() restores existing subscriptions. For an initial connection, wait before registering.
    let active = true;
    c.connected.then(() => {
        if (!active) return;
        entry = [...c.subs.values()].find(e => e.path === r.path);
        if (entry) { entry.listeners.set(callback, error); if (entry.loaded) callback(snapshot(entry.current)); return; }
        entry = { path: r.path, sub, listeners: new Map([[callback, error]]), loaded: false,
            deliver(value) { this.current = structuredClone(value); this.loaded = true; for (const fn of this.listeners.keys()) fn(snapshot(value)); },
            error(error) { for (const fn of this.listeners.values()) fn(error); } };
        entry.deliver = entry.deliver.bind(entry); entry.error = entry.error.bind(entry);
        c.subs.set(sub, entry);
        c.raw({ op: 'subscribe', path: r.path, sub }).then(entry.deliver).catch(entry.error);
    }).catch(error);
    return () => { active = false; if (!entry) return; entry.listeners.delete(callback); if (entry.listeners.size) return; c.subs.delete(entry.sub); if (c.ws.readyState === WebSocket.OPEN) c.send({ op: 'unsubscribe', sub: entry.sub }).catch(report); };
}
export const onDisconnect = r => ({ set: value => connection(r.path).send({ op: 'disconnect', path: r.path, value }) });
export const addFriend = code => accounts.send({ op: 'addFriend', code });
export const sendInvite = (to, value) => accounts.send({ op: 'invite', to, gameType: value.gameType, roomId: value.roomId });
setInterval(() => {
    for (const c of [accounts, ...rooms.values()]) if (c.ws?.readyState === WebSocket.OPEN) c.ws.send('ping');
}, 25000);
const presence = () => {
    if (!identity || accounts.idle) return;
    const game = location.pathname.split('/')[1];
    const status = { eshiritori: 'shiritori', 'drawing-quiz': 'quiz', 'drawing-telephone': 'telephone', 'word-wolf': 'wordwolf', 'typing-race': 'typing', 'quiz-battle': 'quizbattle', 'memory-cards': 'memory' }[game];
    accounts.send({ op: 'update', path: `users/${identity.uid}`, value: { status: status ? `playing_${status}` : 'online', lastActive: Date.now() } }).catch(report);
};
ready.then(presence).catch(report);
setInterval(presence, 20000);
