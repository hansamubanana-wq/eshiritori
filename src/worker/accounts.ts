import { DurableObject } from 'cloudflare:workers';
import type { Env } from './index';
import { GAME_NAMES, GAME_TYPES, uid, roomCode } from './schema';
import { attachment, assert, fail, LIMITS, parse, parts, plain, read, send, subscription, saveAttachment, type Attachment } from './wire';

type Account = { id: string; hash: string; code: string; profile: string; friends: string; invites: string; created_ip: string; last_used: number };
const hash = async (token: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), b => b.toString(16).padStart(2, '0')).join('');
const key = () => crypto.randomUUID().replaceAll('-', '');
function validName(v: any) { assert(typeof v === 'string' && v.trim().length > 0 && v.length <= 40 && !/[<>\x00-\x1f]/.test(v), 'invalid_name'); }
const statuses = ['online', 'offline', 'playing_shiritori', 'playing_quiz', 'playing_telephone', 'playing_wordwolf', 'playing_typing', 'playing_quizbattle', 'playing_memory'];

export class Accounts extends DurableObject<Env> {
  private messages: Promise<unknown> = Promise.resolve();
  private queued = 0;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, hash TEXT NOT NULL, code TEXT UNIQUE NOT NULL, profile TEXT NOT NULL, friends TEXT NOT NULL, invites TEXT NOT NULL)');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS quotas (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL)');
    const columns = ctx.storage.sql.exec<{name: string}>('PRAGMA table_info(accounts)').toArray().map(c => c.name);
    if (!columns.includes('created_ip')) ctx.storage.sql.exec("ALTER TABLE accounts ADD COLUMN created_ip TEXT NOT NULL DEFAULT 'legacy'");
    if (!columns.includes('last_used')) {
      ctx.storage.sql.exec('ALTER TABLE accounts ADD COLUMN last_used INTEGER NOT NULL DEFAULT 0');
      ctx.storage.sql.exec("UPDATE accounts SET last_used = COALESCE(json_extract(profile, '$.lastActive'), ?)", Date.now());
    }
    ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS accounts_ip ON accounts(created_ip)');
    ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS accounts_used ON accounts(last_used)');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS room_registry (name TEXT PRIMARY KEY, expires INTEGER NOT NULL)');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS tickets (ticket TEXT PRIMARY KEY, uid TEXT NOT NULL, ip TEXT NOT NULL, room TEXT NOT NULL, expires INTEGER NOT NULL)');
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }
  private account(id: string) { return this.ctx.storage.sql.exec<Account>('SELECT * FROM accounts WHERE id = ? AND last_used > ?', id, Date.now() - LIMITS.accountTTL).toArray()[0]; }
  private touch(id: string) { this.ctx.storage.sql.exec('UPDATE accounts SET last_used = ? WHERE id = ?', Date.now(), id); }
  private cleanup() {
    const now = Date.now();
    for (const stale of this.ctx.storage.sql.exec<Account>('SELECT * FROM accounts WHERE last_used <= ? LIMIT 100', now - LIMITS.accountTTL).toArray()) {
      this.ctx.storage.transactionSync(() => {
        for (const friend of Object.keys(JSON.parse(stale.friends))) {
          const other = this.account(friend); if (!other) continue;
          const friends = JSON.parse(other.friends); delete friends[stale.id];
          this.ctx.storage.sql.exec('UPDATE accounts SET friends = ? WHERE id = ?', JSON.stringify(friends), friend);
        }
        this.ctx.storage.sql.exec('DELETE FROM tickets WHERE uid = ?', stale.id);
        this.ctx.storage.sql.exec('DELETE FROM accounts WHERE id = ?', stale.id);
      });
    }
    this.ctx.storage.sql.exec('DELETE FROM tickets WHERE expires <= ?', now);
    this.ctx.storage.sql.exec('DELETE FROM room_registry WHERE expires <= ?', now);
    this.ctx.storage.sql.exec('DELETE FROM quotas WHERE expires <= ?', now);
  }
  private active(ws: WebSocket) { return ws.readyState === WebSocket.OPEN; }
  private expired(a: Attachment) { return Date.now() - a.opened >= LIMITS.connectionTTL || Date.now() - (a.lastAction || a.opened) >= LIMITS.idle; }
  private quota(k: string, max: number, duration = 3600000) {
    const now = Date.now();
    const r = this.ctx.storage.sql.exec<{count: number; expires: number}>('SELECT count, expires FROM quotas WHERE key = ?', k).toArray()[0];
    assert(!r || r.expires <= now || r.count < max, 'rate_limited');
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO quotas VALUES (?, ?, ?)', k, r && r.expires > now ? r.count + 1 : 1, r && r.expires > now ? r.expires : now + duration);
  }
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    // Only a binding can reach these paths: the public Worker routes exclusively /ws.
    if (url.pathname === '/verify' && req.method === 'POST') {
      const { id, token } = await req.json<any>();
      const a = uid(id) && typeof token === 'string' && token.length === 64 ? this.account(id) : null;
      return Response.json({ ok: !!a && a.hash === await hash(token || '') });
    }
    if (url.pathname === '/admit-room' && req.method === 'POST') {
      const body = await req.json<any>();
      try {
        this.quota(`room-attempt:${body.ip}`, LIMITS.ipRoomAttemptsPerMinute, 60000);
        assert(typeof body.ticket === 'string' && /^[a-f0-9]{64}$/.test(body.ticket), 'invalid_ticket');
        const ticket = this.ctx.storage.sql.exec<{uid: string; ip: string; room: string; expires: number}>('SELECT * FROM tickets WHERE ticket = ?', body.ticket).toArray()[0];
        assert(ticket && ticket.expires > Date.now() && ticket.ip === body.ip && ticket.room === `${body.game}/${body.code}` && this.account(ticket.uid), 'invalid_ticket');
        this.cleanup();
        this.ctx.storage.transactionSync(() => {
          if (!this.ctx.storage.sql.exec('SELECT name FROM room_registry WHERE name = ?', ticket.room).toArray().length) {
            assert(this.ctx.storage.sql.exec<{n:number}>('SELECT count(*) AS n FROM room_registry').toArray()[0].n < LIMITS.activeRooms, 'rooms_full');
            this.quota(`rooms:${ticket.uid}`, 30); this.quota(`new-room-ip:${body.ip}`, 60);
            this.ctx.storage.sql.exec('INSERT INTO room_registry VALUES (?, ?)', ticket.room, Date.now() + LIMITS.reservationTTL);
          }
          this.ctx.storage.sql.exec('DELETE FROM tickets WHERE ticket = ?', body.ticket);
        });
        return Response.json({ uid: ticket.uid });
      } catch (error) { const code = (error as Error).message; return new Response(code, { status: code === 'invalid_ticket' ? 401 : 429 }); }
    }
    if (url.pathname === '/room-activity' && req.method === 'POST') {
      const { id, room } = await req.json<any>(); const account = uid(id) ? this.account(id) : null;
      if (!account || !this.ctx.storage.sql.exec('SELECT name FROM room_registry WHERE name = ? AND expires > ?', room, Date.now()).toArray().length) return Response.json({ ok: false });
      this.touch(id);
      for (const ws of this.ctx.getWebSockets()) {
        const a = ws.deserializeAttachment() as Attachment;
        if (a.uid === id && this.active(ws) && !this.expired(a)) { a.lastAction = Date.now(); ws.serializeAttachment(a); }
      }
      this.ctx.storage.sql.exec('UPDATE room_registry SET expires = ? WHERE name = ?', Date.now() + LIMITS.ttl, room);
      return Response.json({ ok: true, name: JSON.parse(account.profile).name || 'ゲスト' });
    }
    assert(url.pathname === '/ws', 'not_found');
    this.cleanup();
    const ip = req.headers.get('CF-Connecting-IP') || 'local';
    try { this.quota(`connect:${ip}`, LIMITS.ipConnectionsPerMinute, 60000); } catch { return new Response('rate_limited', { status: 429 }); }
    const sockets = this.ctx.getWebSockets().filter(ws => this.active(ws));
    if (sockets.length >= LIMITS.accountConnections) return new Response('Connections full', { status: 429 });
    if (sockets.filter(ws => this.ctx.getTags(ws)[0] === ip).length >= LIMITS.accountIPConnections) return new Response('ip_connections_full', { status: 429 });
    const pair = new WebSocketPair();
    const a = attachment();
    a.ip = ip; a.lastAction = a.opened;
    this.ctx.acceptWebSocket(pair[1], [ip]);
    pair[1].serializeAttachment(a);
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null || alarm > Date.now() + 30000) await this.ctx.storage.setAlarm(Date.now() + 30000);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    const a = ws.deserializeAttachment() as Attachment;
    let m: any;
    try { m = parse(data, a); assert(this.queued < 64, 'rate_limited'); ws.serializeAttachment(a); }
    catch (error) { ws.serializeAttachment(a); fail(ws, m?.id, error); return; }
    this.queued++;
    const pending = this.messages.then(() => { if (this.active(ws)) return this.handleMessage(ws, m); }).finally(() => { this.queued--; });
    this.messages = pending.catch(() => {}); return pending;
  }
  private async handleMessage(ws: WebSocket, m: any) {
    const a = ws.deserializeAttachment() as Attachment;
    try {
      assert(!this.expired(a), 'connection_expired');
      let value: any = null;
      if (m.op === 'auth') {
        assert(!a.uid, 'already_authenticated');
        let account: Account | undefined;
        let token = m.token;
        if (m.uid || token) {
          assert(uid(m.uid) && typeof token === 'string' && /^[a-f0-9]{64}$/.test(token), 'invalid_credentials');
          account = this.account(m.uid);
          assert(account && account.hash === await hash(token), 'invalid_credentials');
        } else {
          const ip = this.ctx.getTags(ws)[0] || 'unknown';
          const id = `u_${key()}`; token = key() + key();
          const code = `FR-${key().slice(0, 12).toUpperCase()}`;
          const tokenHash = await hash(token);
          this.cleanup();
          this.ctx.storage.transactionSync(() => {
            assert(this.ctx.storage.sql.exec<{n:number}>('SELECT count(*) AS n FROM accounts').toArray()[0].n < LIMITS.accounts, 'accounts_full');
            assert(this.ctx.storage.sql.exec<{n:number}>('SELECT count(*) AS n FROM accounts WHERE created_ip = ?', ip).toArray()[0].n < LIMITS.accountsPerIP, 'ip_accounts_full');
            this.quota(`signup:${ip}`, 60);
            this.ctx.storage.sql.exec('INSERT INTO accounts VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, tokenHash, code, JSON.stringify({ name: '', friendCode: code, status: 'offline', lastActive: Date.now() }), '{}', '{}', ip, Date.now());
          });
          account = this.account(id)!;
        }
        assert(this.ctx.getWebSockets().filter(s => this.active(s) && (s.deserializeAttachment() as Attachment).uid === account!.id).length < LIMITS.userConnections, 'connections_full');
        if (account.created_ip === 'legacy') {
          const ip = this.ctx.getTags(ws)[0];
          assert(this.ctx.storage.sql.exec<{n:number}>('SELECT count(*) AS n FROM accounts WHERE created_ip = ?', ip).toArray()[0].n < LIMITS.accountsPerIP, 'ip_accounts_full');
          this.ctx.storage.sql.exec('UPDATE accounts SET created_ip = ? WHERE id = ?', ip, account.id);
        }
        a.uid = account.id; a.authenticatedAt = Date.now();
        this.touch(account.id); a.lastAction = Date.now();
        const profile = JSON.parse(account.profile); profile.status = 'online'; profile.lastActive = Date.now();
        this.ctx.storage.sql.exec('UPDATE accounts SET profile = ? WHERE id = ?', JSON.stringify(profile), account.id);
        value = { uid: a.uid, token, friendCode: account.code };
      } else {
        assert(a.uid && this.account(a.uid), 'unauthenticated');
        const own = this.account(a.uid)!;
        const presenceOnly = ['set', 'update', 'disconnect'].includes(m.op) && typeof m.path === 'string' && m.path.startsWith(`users/${a.uid}`) &&
          (['status', 'lastActive'].includes(m.path.split('/')[2]) || plain(m.value) && Object.keys(m.value).every(k => ['status', 'lastActive'].includes(k)));
        if (!presenceOnly) { a.lastAction = Date.now(); this.touch(a.uid); }
        if (m.op === 'roomTicket') {
          assert(typeof m.game === 'string' && GAME_TYPES.includes(m.game) && roomCode(m.room), 'invalid_room');
          this.quota(`ticket-ip:${a.ip || this.ctx.getTags(ws)[0]}`, 120, 60000);
          this.ctx.storage.sql.exec('DELETE FROM tickets WHERE expires <= ?', Date.now());
          assert(this.ctx.storage.sql.exec<{n:number}>('SELECT count(*) AS n FROM tickets WHERE uid = ?', a.uid).toArray()[0].n < 8, 'tickets_full');
          const ticket = key() + key();
          this.ctx.storage.sql.exec('INSERT INTO tickets VALUES (?, ?, ?, ?, ?)', ticket, a.uid, a.ip || this.ctx.getTags(ws)[0], `${m.game}/${m.room}`, Date.now() + LIMITS.ticketTTL);
          value = ticket;
        } else if (m.op === 'get' || m.op === 'subscribe') {
          value = this.readPath(a.uid, m.path);
          if (m.op === 'subscribe') {
            subscription(a, m.sub, m.path);
          }
        } else if (m.op === 'unsubscribe') { delete a.subs[m.sub]; }
        else if (['set', 'update', 'remove', 'disconnect'].includes(m.op)) {
          const p = parts(m.path);
          assert(p[0] === 'users' && p[1] === a.uid, 'forbidden');
          if (m.op === 'disconnect') {
            assert(p.length === 3 && p[2] === 'status' && m.value === 'offline', 'forbidden');
            a.disconnect = { status: 'offline' };
          } else if (p[2] === 'invites' && p.length === 4 && m.op === 'remove') {
            const inv = JSON.parse(own.invites); delete inv[p[3]];
            this.ctx.storage.sql.exec('UPDATE accounts SET invites = ? WHERE id = ?', JSON.stringify(inv), a.uid);
          } else {
            assert(p.length === 2 || p.length === 3 && ['name', 'status', 'lastActive'].includes(p[2]), 'forbidden_path');
            const changes = p.length === 2 ? m.value : { [p[2]]: m.value };
            assert(m.op !== 'remove' && plain(changes) && Object.keys(changes).length <= 4, 'invalid_profile');
            const profile = JSON.parse(own.profile);
            for (const [k, v] of Object.entries(changes)) {
              assert(['name', 'status', 'lastActive', 'friendCode'].includes(k), 'forbidden_path');
              if (k === 'name') validName(v);
              if (k === 'status') assert(statuses.includes(v as string), 'invalid_status');
              if (k === 'friendCode') assert(v === own.code, 'forbidden');
              if (k === 'lastActive') assert(typeof v === 'number' && Number.isFinite(v), 'invalid_timestamp');
              profile[k] = k === 'lastActive' ? Date.now() : v;
            }
            this.ctx.storage.sql.exec('UPDATE accounts SET profile = ? WHERE id = ?', JSON.stringify(profile), a.uid);
          }
        } else if (m.op === 'addFriend') {
          assert(typeof m.code === 'string' && /^FR-[A-F0-9]{12}$/.test(m.code), 'invalid_code');
          this.quota(`lookup:${a.uid}`, 60);
          const friend = this.ctx.storage.sql.exec<Account>('SELECT * FROM accounts WHERE code = ?', m.code).toArray()[0];
          assert(friend && friend.id !== a.uid, 'friend_not_found');
          const mine = JSON.parse(own.friends), theirs = JSON.parse(friend.friends);
          assert(Object.keys(mine).length < 100 && Object.keys(theirs).length < 100, 'friends_full');
          mine[friend.id] = true; theirs[a.uid] = true;
          this.ctx.storage.transactionSync(() => {
            this.ctx.storage.sql.exec('UPDATE accounts SET friends = ? WHERE id = ?', JSON.stringify(mine), a.uid!);
            this.ctx.storage.sql.exec('UPDATE accounts SET friends = ? WHERE id = ?', JSON.stringify(theirs), friend.id);
          });
          value = friend.id;
        } else if (m.op === 'invite') {
          assert(uid(m.to) && JSON.parse(own.friends)[m.to], 'not_friends');
          assert(typeof m.gameType === 'string' && Object.hasOwn(GAME_NAMES, m.gameType) && roomCode(m.roomId), 'invalid_invite');
          this.quota(`invite:${a.uid}`, 30, 60000);
          const game = GAME_NAMES[m.gameType];
          assert(this.ctx.storage.sql.exec('SELECT name FROM room_registry WHERE name = ? AND expires > ?', `${game}/${m.roomId}`, Date.now()).toArray().length, 'not_member');
          const check = await this.env.ROOMS.get(this.env.ROOMS.idFromName(`${game}/${m.roomId}`)).fetch(new Request('https://internal/member', { method: 'POST', body: JSON.stringify({ uid: a.uid }) }));
          assert((await check.json<any>()).ok, 'not_member');
          const friend = this.account(m.to); assert(friend, 'friend_not_found');
          const inv = JSON.parse(friend.invites);
          for (const [k, v] of Object.entries(inv)) if (Date.now() - (v as any).timestamp > 60000) delete inv[k];
          assert(Object.keys(inv).length < 20, 'invites_full');
          inv[`k_${key()}`] = { fromName: JSON.parse(own.profile).name, roomId: m.roomId, gameType: m.gameType, timestamp: Date.now() };
          this.ctx.storage.sql.exec('UPDATE accounts SET invites = ? WHERE id = ?', JSON.stringify(inv), friend.id);
        } else throw new Error('invalid_operation');
      }
      saveAttachment(ws, a);
      if (!['get', 'subscribe', 'unsubscribe', 'disconnect', 'roomTicket'].includes(m.op)) this.broadcast();
      send(ws, { id: m.id, value });
    } catch (e) { saveAttachment(ws, a); fail(ws, m?.id, e); if ((e as Error).message === 'connection_expired') ws.close(4002, 'connection_expired'); }
  }
  private readPath(id: string, path: unknown) {
    const p = parts(path);
    const own = this.account(id)!;
    if (p[0] === 'friend-codes') {
      assert(p.length === 2 && /^FR-[A-F0-9]{12}$/.test(p[1]), 'forbidden_path');
      this.quota(`lookup:${id}`, 60);
      return this.ctx.storage.sql.exec<{id: string}>('SELECT id FROM accounts WHERE code = ?', p[1]).toArray()[0]?.id ?? null;
    }
    assert(p[0] === 'users' && uid(p[1]), 'forbidden_path');
    if (p[1] !== id) {
      assert(p.length === 2 && JSON.parse(own.friends)[p[1]], 'forbidden');
      const friend = this.account(p[1]); if (!friend) return null;
      const { name, status, lastActive } = JSON.parse(friend.profile);
      return { name, status, lastActive }; // No friends/invites/code/hash/token in another user's profile.
    }
    assert(p.length === 2 || p.length === 3 && ['name', 'status', 'lastActive', 'friends', 'invites'].includes(p[2]) || p.length === 4 && p[2] === 'invites' && /^k_[a-f0-9]{32}$/.test(p[3]), 'forbidden_path');
    return read({ ...JSON.parse(own.profile), friends: JSON.parse(own.friends), invites: JSON.parse(own.invites) }, p.slice(2));
  }
  private broadcast() {
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment;
      if (!a.uid) continue;
      for (const [sub, path] of Object.entries(a.subs)) {
        try { send(ws, { sub, value: this.readPath(a.uid, path) }); } catch { send(ws, { sub, error: 'forbidden' }); }
      }
    }
  }
  async webSocketClose(ws: WebSocket) { this.closed(ws); }
  async webSocketError(ws: WebSocket) { this.closed(ws); }
  private closed(ws: WebSocket) {
    const a = ws.deserializeAttachment() as Attachment;
    try { ws.close(); } catch {}
    if (!a.uid || this.ctx.getWebSockets().some(s => s !== ws && (s.deserializeAttachment() as Attachment).uid === a.uid)) return;
    const own = this.account(a.uid); if (!own) return;
    const profile = JSON.parse(own.profile); profile.status = 'offline';
    this.ctx.storage.sql.exec('UPDATE accounts SET profile = ? WHERE id = ?', JSON.stringify(profile), a.uid);
    this.broadcast();
  }
  async alarm() {
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment;
      if (!a.uid && Date.now() - a.opened > 30000) { try { ws.close(1008, 'auth_timeout'); } catch {} }
      else if (this.expired(a) || a.uid && !this.account(a.uid)) { try { ws.close(4002, 'connection_expired'); } catch {} }
    }
    this.cleanup();
    const now = Date.now();
    const oldest = this.ctx.storage.sql.exec<{used: number | null}>('SELECT min(last_used) AS used FROM accounts').toArray()[0].used;
    const next = Math.min(now + (this.ctx.getWebSockets().some(ws => this.active(ws)) ? 30000 : 3600000), oldest === null ? Infinity : oldest + LIMITS.accountTTL);
    await this.ctx.storage.setAlarm(Math.max(now + 1000, next));
  }
}
