// Test-only entrypoint, excluded from uploaded assets and the production Worker.
import worker from '../src/worker/index';
import { Room as ProductionRoom } from '../src/worker/room';
import { LIMITS } from '../src/worker/wire';
import { Accounts as ProductionAccounts } from '../src/worker/accounts';
export class Accounts extends ProductionAccounts {
  async fetch(req: Request) {
    if (new URL(req.url).pathname !== '/test-fixture') return super.fetch(req);
    const m = await req.json<any>(), sql = this.ctx.storage.sql;
    if (m.op === 'fillRooms') {
      this.ctx.storage.transactionSync(() => {
        const count = sql.exec<{n:number}>('SELECT count(*) AS n FROM room_registry').toArray()[0].n;
        for (let i = count; i < LIMITS.activeRooms; i++) sql.exec('INSERT INTO room_registry VALUES (?, ?)', `fixture/${i}`, Date.now() + LIMITS.ttl);
      });
    }
    if (m.op === 'clearRooms') sql.exec("DELETE FROM room_registry WHERE name LIKE 'fixture/%'");
    if (m.op === 'fillAccounts') {
      this.ctx.storage.transactionSync(() => {
        const count = m.ip ? sql.exec<{n:number}>('SELECT count(*) AS n FROM accounts WHERE created_ip = ?', m.ip).toArray()[0].n : sql.exec<{n:number}>('SELECT count(*) AS n FROM accounts').toArray()[0].n;
        for (let i = count; i < (m.ip ? LIMITS.accountsPerIP : LIMITS.accounts); i++) sql.exec('INSERT OR IGNORE INTO accounts VALUES (?, ?, ?, ?, ?, ?, ?, ?)', `u_${i.toString(16).padStart(32, '0')}`, 'fixture', `FR-${i.toString(16).padStart(12, '0').toUpperCase()}`, '{}', '{}', '{}', m.ip || 'fixture', Date.now());
      });
    }
    if (m.op === 'clearAccounts') sql.exec("DELETE FROM accounts WHERE hash = 'fixture'");
    if (m.op === 'expireAccount') sql.exec('UPDATE accounts SET last_used = ? WHERE id = ?', Date.now() - LIMITS.accountTTL - 1, m.uid);
    if (m.op === 'expireTicket') sql.exec('UPDATE tickets SET expires = ? WHERE ticket = ?', Date.now() - 1, m.ticket);
    if (m.op === 'ageSocket') {
      for (const ws of this.ctx.getWebSockets()) {
        const a = ws.deserializeAttachment() as any;
        if (a.ip === m.ip) { if (m.absolute) a.opened = Date.now() - LIMITS.connectionTTL - 1; else a.lastAction = Date.now() - LIMITS.idle + (m.remaining || -1); ws.serializeAttachment(a); }
      }
    }
    if (m.op === 'quota') sql.exec('INSERT OR REPLACE INTO quotas VALUES (?, ?, ?)', m.key, m.count, Date.now() + 60000);
    if (m.op === 'lateAlarm') await this.ctx.storage.setAlarm(Date.now() + 3600000);
    if (m.alarm) await this.alarm();
    return Response.json({ accounts: sql.exec('SELECT count(*) AS n FROM accounts').toArray()[0].n, rooms: sql.exec('SELECT count(*) AS n FROM room_registry').toArray()[0].n,
      tickets: sql.exec('SELECT count(*) AS n FROM tickets').toArray()[0].n, nextAlarm: await this.ctx.storage.getAlarm(), now:Date.now(),
      sockets: this.ctx.getWebSockets().map(ws => ({ ...(ws.deserializeAttachment() as object), readyState: ws.readyState })) });
  }
}
export class Room extends ProductionRoom {
  async fetch(req: Request) {
    const path = new URL(req.url).pathname;
    if (path === '/test-expire') {
      (this as any).touched = Date.now() - LIMITS.ttl - 1;
      this.ctx.storage.sql.exec('UPDATE room SET touched = ?', (this as any).touched);
      await this.alarm();
      return Response.json({ cleared: (this as any).data === null });
    }
    if (path === '/test-alarm') {
      await this.alarm();
      return Response.json({ alive: !!(this as any).data, next: await this.ctx.storage.getAlarm() });
    }
    if (path === '/test-budget') {
      (this as any).out = { tokens: 0, tick: Date.now() + 60000 };
      this.ctx.storage.sql.exec('INSERT OR REPLACE INTO outbound VALUES (1, ?, ?)', 0, Date.now() + 60000);
      return Response.json({ ok: true });
    }
    return super.fetch(req);
  }
}
let roomCalls = 0;
export default {
  async fetch(req: Request, env: any) {
    if (new URL(req.url).pathname === '/test-room-calls') return Response.json({ roomCalls });
    const url=new URL(req.url),game=url.searchParams.get('game'),room=url.searchParams.get('room');
    // Historical room protocol is available ONLY in this isolated regression harness.
    if(url.pathname==='/ws'&&game&&room){
      const result=await env.ACCOUNTS.get(env.ACCOUNTS.idFromName('accounts')).fetch(new Request('https://internal/admit-room',{method:'POST',body:JSON.stringify({game,code:room,ticket:url.searchParams.get('ticket'),ip:req.headers.get('CF-Connecting-IP')||'local'})}));
      if(!result.ok)return new Response(await result.text(),{status:result.status});
      const a=await result.json<any>(),headers=new Headers(req.headers);headers.set('X-Authenticated-Uid',a.uid);roomCalls++;
      return env.ROOMS.get(env.ROOMS.idFromName(`${game}/${room}`)).fetch(new Request(url,{headers}));
    }
    return env.ACCOUNTS.get(env.ACCOUNTS.idFromName('accounts')).fetch(req);
  },
};
