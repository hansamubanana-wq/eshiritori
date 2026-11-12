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
    open() {
        return new Promise((resolve, reject) => {
            const url = new URL('/ws', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
            if (this.game) { url.searchParams.set('game', this.game); url.searchParams.set('room', this.room); }
            const ws = this.ws = new WebSocket(url);
            let authenticated = false;
            ws.onopen = async () => {
                try {
                    const credentials = this.game ? await ready : identity;
                    const auth = await this.raw({ op: 'auth', ...(credentials ? { uid: credentials.uid, token: credentials.token } : {}) });
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
                if (message.sub) {
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
                if (this.hasAuthenticated && event.code !== 1008 && event.code !== 4001) {
                    this.connected = new Promise((res, rej) => setTimeout(() => this.open().then(res, rej), this.retry));
                    this.connected.catch(report); this.retry = Math.min(this.retry * 2, 10000);
                }
                if (event.code === 4001) report(new Error('room_expired'));
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
    async send(payload) { await this.connected; return this.raw(payload); }
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
    const entry = { path: r.path, deliver: value => callback(snapshot(value)), error };
    // open() restores existing subscriptions. For an initial connection, wait before registering.
    let active = true;
    c.connected.then(() => {
        if (!active) return;
        c.subs.set(sub, entry);
        c.raw({ op: 'subscribe', path: r.path, sub }).then(entry.deliver).catch(error);
    }).catch(error);
    return () => { active = false; c.subs.delete(sub); if (c.ws.readyState === WebSocket.OPEN) c.send({ op: 'unsubscribe', sub }).catch(report); };
}
export const onDisconnect = r => ({ set: value => connection(r.path).send({ op: 'disconnect', path: r.path, value }) });
export const addFriend = code => accounts.send({ op: 'addFriend', code });
export const sendInvite = (to, value) => accounts.send({ op: 'invite', to, gameType: value.gameType, roomId: value.roomId });
setInterval(() => {
    for (const c of [accounts, ...rooms.values()]) if (c.ws?.readyState === WebSocket.OPEN) c.ws.send('ping');
}, 25000);
const presence = () => {
    if (!identity) return;
    const game = location.pathname.split('/')[1];
    const status = { eshiritori: 'shiritori', 'drawing-quiz': 'quiz', 'drawing-telephone': 'telephone', 'word-wolf': 'wordwolf', 'typing-race': 'typing', 'quiz-battle': 'quizbattle', 'memory-cards': 'memory' }[game];
    accounts.send({ op: 'update', path: `users/${identity.uid}`, value: { status: status ? `playing_${status}` : 'online', lastActive: Date.now() } }).catch(report);
};
ready.then(presence).catch(report);
setInterval(presence, 20000);
