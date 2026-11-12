import { DurableObject } from 'cloudflare:workers';
import type { Env } from './index';
import { GAME_TYPES, mutations, roomCode, SCHEMAS, uid, validate } from './schema';
import { attachment, assert, bytes, fail, LIMITS, parse, parts, plain, read, boundedSend, subscription, saveAttachment, write, type Attachment, type Bucket } from './wire';
import { diff, overlaps, type Patch } from './patch';

export class Room extends DurableObject<Env> {
  protected messages: Promise<unknown> = Promise.resolve();
  private queued = 0;
  protected game = '';
  protected code = '';
  protected data: any = null;
  protected host = '';
  protected members: Record<string, boolean> = {};
  protected touched = 0;
  protected out: Bucket = { tokens: LIMITS.roomOutgoingBurst, tick: Date.now() };
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS room (id INTEGER PRIMARY KEY, game TEXT, code TEXT, state TEXT, host TEXT, members TEXT, touched INTEGER)');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS outbound (id INTEGER PRIMARY KEY, tokens REAL, tick INTEGER)');
    const budget = ctx.storage.sql.exec<{tokens:number; tick:number}>('SELECT tokens, tick FROM outbound WHERE id = 1').toArray()[0]; if (budget) this.out = budget;
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
    const authenticatedUid = req.headers.get('X-Authenticated-Uid');
    if (!uid(authenticatedUid)) return new Response('unauthenticated', { status: 401 });
    assert(url.pathname === '/ws' && game && GAME_TYPES.includes(game) && roomCode(code), 'invalid_room');
    assert(!this.game || this.game === game && this.code === code, 'invalid_room');
    this.game = game; this.code = code;
    const sockets = this.ctx.getWebSockets().filter(ws => ws.readyState === WebSocket.OPEN);
    if (sockets.length >= LIMITS.roomConnections || sockets.filter(ws => (ws.deserializeAttachment() as Attachment).uid === authenticatedUid).length >= LIMITS.userConnections) return new Response('connections_full', { status: 429 });
    const pair = new WebSocketPair(); this.ctx.acceptWebSocket(pair[1]);
    const a = attachment(); a.uid = authenticatedUid; a.authenticatedAt = Date.now(); pair[1].serializeAttachment(a);
    // Also reclaim sockets that never authenticate, without waiting 24 hours.
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null || alarm > Date.now() + 30000) await this.ctx.storage.setAlarm(Date.now() + 30000);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const a = ws.deserializeAttachment() as Attachment;
    let m: any;
    try { m = parse(raw, a); assert(this.queued < 64, 'rate_limited'); ws.serializeAttachment(a); }
    catch (error) { ws.serializeAttachment(a); fail(ws, m?.id, error); return; }
    this.queued++;
    const pending = this.messages.then(() => { if (ws.readyState === WebSocket.OPEN) return this.handleMessage(ws, m); }).finally(() => { this.queued--; });
    this.messages = pending.catch(() => {}); return pending;
  }
  protected async handleMessage(ws: WebSocket, m: any) {
    const a = ws.deserializeAttachment() as Attachment;
    try {
      let value: any = null;
      let patches: Patch[] = [];
      if (m.op === 'auth') {
        assert(a.uid === m.uid && !a.confirmed, 'invalid_credentials'); a.confirmed = true;
      } else {
        assert(a.uid, 'unauthenticated');
        if (m.op === 'get' || m.op === 'subscribe') {
          value = this.readPath(m.path);
          if (m.op === 'subscribe') {
            subscription(a, m.sub, m.path);
          }
        } else if (m.op === 'unsubscribe') delete a.subs[m.sub];
        else {
          const changes = mutations(this.game, this.code, m);
          const profile = await this.env.ACCOUNTS.get(this.env.ACCOUNTS.idFromName('accounts')).fetch(new Request('https://internal/room-activity', { method: 'POST', body: JSON.stringify({ id: a.uid, room: `${this.game}/${this.code}` }) })).then(r => r.json<{ok:boolean; name:string}>());
          assert(profile.ok, 'unauthenticated');
          const before = this.data;
          this.mutate(a.uid, changes, profile.name);
          patches = diff(before, this.data);
          await this.schedule();
        }
      }
      saveAttachment(ws, a);
      if (patches.length) this.broadcast(patches);
      boundedSend(ws, { id: m.id, value }, ws.deserializeAttachment() as Attachment, this.out);
    } catch (e) { saveAttachment(ws, a); fail(ws, m?.id, e); }
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS outbound (id INTEGER PRIMARY KEY, tokens REAL, tick INTEGER)');
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO outbound VALUES (1, ?, ?)', this.out.tokens, this.out.tick);
  }
  protected readPath(path: unknown) {
    const p = parts(path);
    assert(p[0] === this.game && p[1] === this.code && (p.length === 2 || p.length === 3 && ['comments', 'messages', 'chat'].includes(p[2]) && Object.hasOwn(SCHEMAS[this.game].fields!, p[2])), 'forbidden_path');
    return read(this.data, p.slice(2));
  }
  protected mutate(id: string, changes: [string[], any][], name: string) {
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
    for (const [p, input] of changes) {
      let v = input;
      if (!p.length) {
        assert(changes.length === 1 && plain(v), 'forbidden');
        assert(!old || phase === 'result' && (isHost || !this.ctx.getWebSockets().some(ws => { const a = ws.deserializeAttachment() as Attachment; return a.uid && a.uid !== id && members[a.uid]; })), 'room_exists');
        assert(['waiting', 'lobby'].includes(v.status || v.phase), 'invalid_initial_state');
        assert(!v.players || Object.keys(v.players).every(pid => pid === id), 'forbidden');
        assert(!v.hostId || v.hostId === id, 'forbidden');
        assert(['comments', 'messages', 'chat'].every(field => !v[field] || Object.keys(v[field]).length === 0), 'forbidden_chat_metadata');
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
          else {
            assert(p.length === 2 && !read(old, p) && plain(v), 'forbidden');
            assert(Object.keys(v).length === 1 && typeof v.text === 'string' && v.text.trim().length > 0, 'forbidden_chat_metadata');
            v = p[0] === 'chat' ? { uid: id, name, text: v.text, ts: Date.now() } : { uid: id, sender: name, text: v.text, timestamp: Date.now(), ...(p[0] === 'messages' ? { type: 'chat' } : {}) };
          }
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
    if (this.game === 'rooms-quiz' && old) {
      const system = (text: string, type = 'system') => {
        candidate.messages ||= {};
        candidate.messages[`k_${crypto.randomUUID().replaceAll('-', '')}`] = { sender: 'システム', text, type, timestamp: Date.now() };
      };
      if (candidate.drawerId && (candidate.drawerId !== old.drawerId || candidate.timerEnd !== old.timerEnd)) system(`【第 ${candidate.currentIndex + 1} ラウンド】${candidate.players[candidate.drawerId]?.name || 'ゲスト'} さんがお絵描きする番です！`);
      if (!old.players?.[id]?.guessedCorrectly && candidate.players?.[id]?.guessedCorrectly) {
        const rank = Object.entries(candidate.players).filter(([pid, p]: any) => pid !== candidate.drawerId && p.guessedCorrectly).length;
        const earned = candidate.players[id].score - (old.players?.[id]?.score || 0);
        const drawerEarned = (candidate.players[candidate.drawerId]?.score || 0) - (old.players?.[candidate.drawerId]?.score || 0);
        system(`🎉 ${name} さんが正解しました！ (${rank > 3 ? '4位以降' : `${rank}位`}: +${earned}pt / 描き手 +${drawerEarned}pt)`, 'correct');
      }
      if (candidate.currentIndex !== old.currentIndex && old.drawerId) system(old.timerEnd <= Date.now() ? `時間切れ！正解は「${old.currentWord}」でした。` : '全員正解しました！次のラウンドに進みます。');
    }
    for (const field of ['playersOrder', 'turnOrder']) if (candidate[field]) assert(new Set(candidate[field]).size === candidate[field].length && candidate[field].every((pid: string) => members[pid]), 'invalid_players');
    for (const field of ['comments', 'messages', 'chat']) if (candidate[field]) {
      const entries = Object.entries(candidate[field]); if (entries.length > 200) candidate[field] = Object.fromEntries(entries.slice(-200));
    }
    validate(SCHEMAS[this.game], candidate);
    const json = JSON.stringify(candidate);
    assert(bytes(json) + bytes(JSON.stringify(members)) + bytes(this.game + this.code + nextHost) <= this.stateBudget(), 'room_too_large');
    const touched = Date.now();
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS room (id INTEGER PRIMARY KEY, game TEXT, code TEXT, state TEXT, host TEXT, members TEXT, touched INTEGER)');
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO room VALUES (1, ?, ?, ?, ?, ?, ?)', this.game, this.code, json, nextHost, JSON.stringify(members), touched);
    this.data = candidate; this.host = nextHost; this.members = members; this.touched = touched;
  }
  protected stateBudget(){return LIMITS.room;}
  protected broadcast(patches: Patch[]) {
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment; if (!a.uid) continue;
      const subs = Object.entries(a.subs).filter(([, path]) => patches.some(([p]) => overlaps(parts(path).slice(2), p)));
      if (subs.length) boundedSend(ws, { patches: patches.filter(([p]) => subs.some(([, path]) => overlaps(parts(path).slice(2), p))), subs: subs.map(([sub]) => sub) }, a, this.out);
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
