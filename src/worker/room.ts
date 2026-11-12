import { DurableObject } from 'cloudflare:workers';
import type { Env } from './index';
import { GAME_TYPES, mutations, roomCode, SCHEMAS, uid, validate } from './schema';
import { attachment, assert, bytes, fail, LIMITS, parse, parts, plain, read, send, write, type Attachment } from './wire';

export class Room extends DurableObject<Env> {
  private game = '';
  private code = '';
  private data: any = null;
  private host = '';
  private members: Record<string, boolean> = {};
  private touched = 0;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS room (id INTEGER PRIMARY KEY, game TEXT, code TEXT, state TEXT, host TEXT, members TEXT, touched INTEGER)');
    const row = ctx.storage.sql.exec<any>('SELECT * FROM room WHERE id = 1').toArray()[0];
    if (row) {
      this.game = row.game; this.code = row.code; this.data = JSON.parse(row.state);
      this.host = row.host; this.members = JSON.parse(row.members); this.touched = row.touched;
    }
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/member' && req.method === 'POST') {
      const body = await req.json<any>(); return Response.json({ ok: !!this.data && !!this.members[body.uid] });
    }
    const game = url.searchParams.get('game'), code = url.searchParams.get('room');
    assert(url.pathname === '/ws' && game && GAME_TYPES.includes(game) && roomCode(code), 'invalid_room');
    assert(!this.game || this.game === game && this.code === code, 'invalid_room');
    this.game = game; this.code = code;
    if (this.ctx.getWebSockets().length >= LIMITS.roomConnections) return new Response('Connections full', { status: 429 });
    const pair = new WebSocketPair(); this.ctx.acceptWebSocket(pair[1]); pair[1].serializeAttachment(attachment());
    // Also reclaim sockets that never authenticate, without waiting 24 hours.
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null || alarm > Date.now() + 30000) await this.ctx.storage.setAlarm(Date.now() + 30000);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const a = ws.deserializeAttachment() as Attachment;
    let m: any;
    try {
      m = parse(raw, a);
      let value: any = null;
      if (m.op === 'auth') {
        assert(!a.uid && uid(m.uid) && typeof m.token === 'string' && /^[a-f0-9]{64}$/.test(m.token), 'invalid_credentials');
        const result = await this.env.ACCOUNTS.get(this.env.ACCOUNTS.idFromName('accounts')).fetch(new Request('https://internal/verify', { method: 'POST', body: JSON.stringify({ id: m.uid, token: m.token }) }));
        assert((await result.json<any>()).ok, 'invalid_credentials');
        assert(this.ctx.getWebSockets().filter(s => (s.deserializeAttachment() as Attachment).uid === m.uid).length < LIMITS.userConnections, 'connections_full');
        a.uid = m.uid; a.authenticatedAt = Date.now();
      } else {
        assert(a.uid, 'unauthenticated');
        if (m.op === 'get' || m.op === 'subscribe') {
          value = this.readPath(m.path);
          if (m.op === 'subscribe') {
            assert(typeof m.sub === 'string' && m.sub.length <= 64 && Object.keys(a.subs).length < LIMITS.subscriptions, 'subscriptions_full');
            a.subs[m.sub] = m.path;
          }
        } else if (m.op === 'unsubscribe') delete a.subs[m.sub];
        else {
          const changes = mutations(this.game, this.code, m);
          if (changes.some(([p]) => p.length === 0) && !this.data) {
            const r = await this.env.ACCOUNTS.get(this.env.ACCOUNTS.idFromName('accounts')).fetch(new Request('https://internal/reserve-room', { method: 'POST', body: JSON.stringify({ id: a.uid }) }));
            assert((await r.json<any>()).ok, 'rooms_full');
          }
          this.mutate(a.uid, changes);
          await this.schedule();
        }
      }
      ws.serializeAttachment(a);
      if (['set', 'update', 'remove'].includes(m.op)) this.broadcast();
      send(ws, { id: m.id, value });
    } catch (e) { ws.serializeAttachment(a); fail(ws, m?.id, e); }
  }
  private readPath(path: unknown) {
    const p = parts(path);
    assert(p[0] === this.game && p[1] === this.code && (p.length === 2 || p.length === 3 && ['comments', 'messages', 'chat'].includes(p[2]) && Object.hasOwn(SCHEMAS[this.game].fields!, p[2])), 'forbidden_path');
    return read(this.data, p.slice(2));
  }
  private mutate(id: string, changes: [string[], any][]) {
    const old = this.data;
    const isHost = this.host === id;
    const phase = old?.status || old?.phase;
    const lobby = ['waiting', 'lobby'].includes(phase);
    let candidate = structuredClone(old);
    let nextHost = this.host;
    let members = { ...this.members };
    const isTurn = old && (this.game === 'rooms' ? old.playersOrder?.[old.currentIndex % old.playersOrder.length] === id : this.game === 'memory-card-rooms' ? old.turnOrder?.[old.currentTurnIdx] === id : old.drawerId === id);
    const submitted = old?.players && Object.values(old.players).length > 0 && Object.values(old.players).every((p: any) => p.submitted);
    const guessed = old?.players && Object.entries(old.players).filter(([pid]) => pid !== old.drawerId).every(([, p]: any) => p.guessedCorrectly);
    const quizAdvance = this.game === 'rooms-quiz' && (guessed || old?.timerEnd > 0 && old.timerEnd <= Date.now());
    for (const [p, v] of changes) {
      if (!p.length) {
        assert(changes.length === 1 && plain(v), 'forbidden');
        assert(!old || phase === 'result' && (isHost || !this.ctx.getWebSockets().some(ws => { const a = ws.deserializeAttachment() as Attachment; return a.uid && a.uid !== id && members[a.uid]; })), 'room_exists');
        assert(['waiting', 'lobby'].includes(v.status || v.phase), 'invalid_initial_state');
        assert(!v.players || Object.keys(v.players).every(pid => pid === id), 'forbidden');
        assert(!v.hostId || v.hostId === id, 'forbidden');
        candidate = structuredClone(v); nextHost = id; members = { [id]: true };
        if (candidate.players?.[id]) candidate.players[id].isHost = true;
        continue;
      }
      assert(old, 'room_missing');
      if (p[0] === 'players' && p.length === 2) {
        assert(p[1] === id && lobby && plain(v), 'forbidden');
        assert(old.players?.[id] || Object.keys(old.players || {}).length < LIMITS.players, 'players_full');
        assert(!v.isHost || isHost, 'forbidden');
        members[id] = true;
      } else {
        assert(members[id], 'not_member');
        if (p[0] === 'players') {
          assert(p.length === 3 && old.players?.[p[1]], 'forbidden_path');
          const self = p[1] === id;
          const field = p[2];
          assert(field !== 'isHost' && field !== 'joinedAt', 'forbidden');
          if (field === 'name') assert(self && lobby, 'forbidden');
          else if (field === 'submitted') assert(self || isHost || this.game === 'rooms-telephone' && submitted && v === false, 'forbidden');
          else if (['role', 'word'].includes(field)) assert(isHost && this.game === 'word-wolf-rooms', 'forbidden');
          else if (field === 'score' && this.game === 'rooms-quiz') assert(isHost || self || p[1] === old.drawerId, 'forbidden');
          else if (field === 'guessedCorrectly') assert(self || isHost || quizAdvance && v === false, 'forbidden');
          else assert(self || isHost, 'forbidden');
        } else if (['comments', 'messages', 'chat'].includes(p[0])) {
          if (p.length === 1) assert(isHost && v === null, 'forbidden');
          else assert(p.length === 2 && !read(old, p) && plain(v), 'forbidden');
        } else if (p[0] === 'playersOrder') {
          assert(p.length === 1 && Array.isArray(v) && v.every(pid => members[pid]), 'forbidden');
          if (!isHost) {
            assert(lobby, 'forbidden');
            // Join writes from older clients may race: the server already appended the new player.
            candidate.playersOrder = Array.from(new Set([...(candidate.playersOrder || []), id]));
            continue;
          }
        } else if (p[0] === 'canvasData') assert(isTurn || isHost && v === '', 'not_your_turn');
        else if (p[0] === 'gameData') assert(this.game === 'rooms' && (isTurn || isHost), 'not_your_turn');
        else if (p[0] === 'stepData') {
          assert(this.game === 'rooms-telephone' && (p.length === 1 && isHost || p.length === 3 && p[1] === `step_${old.currentStep}` && p[2] === id && !old.players?.[id]?.submitted), 'forbidden');
        } else if (['currentStep', 'showcaseIndex'].includes(p[0])) assert(isHost || this.game === 'rooms-telephone' && submitted, 'forbidden');
        else if (p[0] === 'currentIndex') assert(isHost || this.game === 'rooms' && isTurn && v === old.currentIndex + 1 || quizAdvance && v === old.currentIndex + 1, 'forbidden');
        else if (this.game === 'rooms-quiz' && ['currentWord', 'drawerId', 'timerEnd'].includes(p[0])) assert(isHost || quizAdvance, 'forbidden');
        else if (p[0] === 'answers') assert(p.length === 1 && isHost && v === null || p.length === 2 && p[1] === id && phase === 'question', 'forbidden');
        else if (this.game === 'memory-card-rooms' && ['cards', 'flipped', 'currentTurnIdx'].includes(p[0])) assert(isHost || isTurn && phase === 'playing', 'not_your_turn');
        else if (p[0] === 'status' && v === 'result') assert(isHost || this.game === 'rooms' && old.currentIndex >= old.playersOrder.length * 4 || this.game === 'rooms-telephone' && submitted || quizAdvance, 'forbidden');
        else assert(isHost && p.length === 1, 'forbidden');
      }
      candidate = write(candidate || {}, p, structuredClone(v));
      if (p[0] === 'players' && p.length === 2 && candidate.playersOrder && !candidate.playersOrder.includes(id)) candidate.playersOrder.push(id);
    }
    assert(candidate && ['waiting', 'playing', 'result', 'lobby', 'word_reveal', 'discussion', 'voting', 'racing', 'question'].includes(candidate.status || candidate.phase), 'invalid_state');
    if (candidate.hostId) assert(candidate.hostId === nextHost, 'forbidden');
    for (const field of ['playersOrder', 'turnOrder']) if (candidate[field]) assert(new Set(candidate[field]).size === candidate[field].length && candidate[field].every((pid: string) => members[pid]), 'invalid_players');
    for (const field of ['comments', 'messages', 'chat']) if (candidate[field]) {
      const entries = Object.entries(candidate[field]); if (entries.length > 200) candidate[field] = Object.fromEntries(entries.slice(-200));
    }
    validate(SCHEMAS[this.game], candidate);
    const json = JSON.stringify(candidate);
    assert(bytes(json) + bytes(JSON.stringify(members)) + bytes(this.game + this.code + nextHost) <= LIMITS.room, 'room_too_large');
    const touched = Date.now();
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS room (id INTEGER PRIMARY KEY, game TEXT, code TEXT, state TEXT, host TEXT, members TEXT, touched INTEGER)');
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO room VALUES (1, ?, ?, ?, ?, ?, ?)', this.game, this.code, json, nextHost, JSON.stringify(members), touched);
    this.data = candidate; this.host = nextHost; this.members = members; this.touched = touched;
  }
  private broadcast() {
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment; if (!a.uid) continue;
      for (const [sub, path] of Object.entries(a.subs)) send(ws, { sub, value: this.readPath(path) });
    }
  }
  private async schedule() {
    let next = this.touched ? this.touched + LIMITS.ttl : Date.now() + 30000;
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment;
      if (!a.uid && ws.readyState === WebSocket.OPEN) next = Math.min(next, a.opened + 30000);
    }
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > next) await this.ctx.storage.setAlarm(next);
  }
  async webSocketClose(ws: WebSocket) { try { ws.close(); } catch {} }
  async webSocketError(ws: WebSocket) { try { ws.close(); } catch {} }
  async alarm() {
    const now = Date.now();
    let unauthenticated = false;
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment;
      if (!a.uid) {
        if (now - a.opened >= 30000) { try { ws.close(1008, 'auth_timeout'); } catch {} }
        else unauthenticated = true;
      }
    }
    if (!this.data || now - this.touched >= LIMITS.ttl) {
      await this.ctx.storage.deleteAll(); this.data = null; this.members = {}; this.host = ''; this.touched = 0;
      for (const ws of this.ctx.getWebSockets()) { try { ws.close(4001, 'room_expired'); } catch {} }
      return;
    }
    await this.ctx.storage.setAlarm(unauthenticated ? Math.min(this.touched + LIMITS.ttl, now + 30000) : this.touched + LIMITS.ttl);
  }
}
