import { Room } from './room';
import type {Env} from './index';
import {TABLES,fixedTable} from '../../catalog.js';
import {uid} from './schema';
import {attachment,assert,boundedSend,fail,saveAttachment,LIMITS,type Attachment} from './wire';
import {identity} from './services';
import {diff} from './patch';
export class Lobby extends Room {
  private views=new Map<WebSocket,any>();
  constructor(ctx:DurableObjectState,env:Env) {
    super(ctx,env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS summaries (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS claims (uid TEXT PRIMARY KEY, table_id TEXT NOT NULL, nonce TEXT NOT NULL, expires INTEGER NOT NULL)');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS lobby_chat (id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT NOT NULL)');
  }
  async fetch(req:Request):Promise<Response> {
    const url=new URL(req.url);
    if(req.method==='POST') {
      const m=await req.json<any>(), now=Date.now();
      if(url.pathname==='/summary') {
        assert(fixedTable(m.game,m.code),'invalid_table');
        this.ctx.storage.sql.exec('INSERT OR REPLACE INTO summaries VALUES (?, ?)',`${m.game}/${m.code}`,JSON.stringify(m));this.publish();return Response.json({ok:true});
      }
      assert(uid(m.uid),'invalid_user');
      const table=fixedTable(m.game,m.code);assert(table,'invalid_table');const id=`${m.game}/${m.code}`;
      const old=this.ctx.storage.sql.exec<{table_id:string;nonce:string;expires:number}>('SELECT * FROM claims WHERE uid = ?',m.uid).toArray()[0];
      if(url.pathname==='/claim') {
        if(old&&old.expires>now&&old.table_id!==id) return Response.json({ok:false,error:'already_seated'});
        const nonce=old&&old.table_id===id&&old.expires>now?old.nonce:crypto.randomUUID();
        const expires=old&&old.nonce===nonce?old.expires:now+15000;
        this.ctx.storage.sql.exec('INSERT OR REPLACE INTO claims VALUES (?, ?, ?, ?)',m.uid,id,nonce,expires);
        await this.ctx.storage.setAlarm(now+15000);return Response.json({ok:true,nonce,expires});
      }
      if(url.pathname==='/renew') {
        if(!old||old.table_id!==id||old.nonce!==m.nonce||old.expires<=now) return Response.json({ok:false,error:'seat_expired'});
        const expires=Math.min(now+600000,Math.max(now+1000,Number(m.until)||now+60000));
        this.ctx.storage.sql.exec('UPDATE claims SET expires = ? WHERE uid = ?',expires,m.uid);return Response.json({ok:true,expires});
      }
      if(url.pathname==='/release') {
        this.ctx.storage.sql.exec('DELETE FROM claims WHERE uid = ? AND table_id = ? AND nonce = ?',m.uid,id,m.nonce);return Response.json({ok:true});
      }
      if(url.pathname==='/lease') return Response.json({ok:!!old&&old.table_id===id&&old.nonce===m.nonce&&old.expires>now});
      return new Response('Not found',{status:404});
    }
    const id=req.headers.get('X-Authenticated-Uid');if(!uid(id))return new Response('unauthenticated',{status:401});
    const ip=req.headers.get('CF-Connecting-IP')||'local',sockets=this.ctx.getWebSockets().filter(s=>s.readyState===WebSocket.OPEN);
    if(sockets.length>=256||sockets.filter(s=>(s.deserializeAttachment() as Attachment).ip===ip).length>=16)return new Response('connections_full',{status:429});
    const pair=new WebSocketPair(),a=attachment();a.uid=id;a.ip=ip;a.lastAction=Date.now();this.ctx.acceptWebSocket(pair[1]);pair[1].serializeAttachment(a);
    await this.ctx.storage.setAlarm(Date.now()+30000);return new Response(null,{status:101,webSocket:pair[0]});
  }
  protected async handleMessage(ws:WebSocket,m:any) {
    const a=ws.deserializeAttachment() as Attachment;
    try {
      assert(a.uid,'unauthenticated');let value:any=null;
      if(m.op==='auth') assert(m.uid===a.uid,'invalid_credentials');
      else if(m.op==='watchLobby'){a.subs.lobby='lobby';value=this.view();}
      else if(m.op==='lobbyChat') {
        assert(typeof m.text==='string'&&m.text.trim()&&m.text.length<=1000&&!/[<>\x00-\x1f]/.test(m.text),'invalid_string');
        const p=await identity(this.env,a.uid,true);assert(p.name,'name_required');
        this.ctx.storage.sql.exec('INSERT INTO lobby_chat(value) VALUES (?)',JSON.stringify({uid:a.uid,name:p.name,text:m.text,timestamp:Date.now()}));
        this.ctx.storage.sql.exec('DELETE FROM lobby_chat WHERE id NOT IN (SELECT id FROM lobby_chat ORDER BY id DESC LIMIT 200)');
        a.lastAction=Date.now();
      } else throw new Error('forbidden_path');
      saveAttachment(ws,a);this.publish();boundedSend(ws,{id:m.id,value},ws.deserializeAttachment() as Attachment,this.out);this.persistBudget();
    } catch(e){saveAttachment(ws,a);fail(ws,m.id,e);}
  }
  private view() {
    const stored=new Map(this.ctx.storage.sql.exec<{id:string;value:string}>('SELECT * FROM summaries').toArray().map(r=>[r.id,JSON.parse(r.value)]));
    return {tables:TABLES.map(t=>stored.get(`${t.game}/${t.code}`)||{...t,phase:'waiting',seats:Array(t.capacity).fill(null),roundId:''}),chat:this.ctx.storage.sql.exec<{value:string}>('SELECT value FROM lobby_chat ORDER BY id').toArray().map(r=>JSON.parse(r.value)),present:new Set(this.ctx.getWebSockets().filter(s=>s.readyState===WebSocket.OPEN).map(s=>(s.deserializeAttachment() as Attachment).uid)).size};
  }
  private publish() {
    const view=this.view();for(const ws of this.ctx.getWebSockets()) {
      const a=ws.deserializeAttachment() as Attachment;if(!a.subs.lobby)continue;
      const prev=this.views.get(ws);const patches=prev?diff(prev,view):null;
      if(!prev||patches!.length)boundedSend(ws,prev?{lobbyPatch:patches}:{lobbyState:view},a,this.out);
      this.views.set(ws,structuredClone(view));
    }
    this.persistBudget();
  }
  private persistBudget(){this.ctx.storage.sql.exec('INSERT OR REPLACE INTO outbound VALUES (1, ?, ?)',this.out.tokens,this.out.tick);}
  async webSocketClose(ws:WebSocket){this.views.delete(ws);try{ws.close();}catch{}this.publish();}
  async webSocketError(ws:WebSocket){await this.webSocketClose(ws);}
  async alarm(){const now=Date.now();this.ctx.storage.sql.exec('DELETE FROM claims WHERE expires <= ?',now);
    for(const ws of this.ctx.getWebSockets()){const a=ws.deserializeAttachment() as Attachment;if(now-(a.lastAction||a.opened)>=LIMITS.idle||now-a.opened>=LIMITS.connectionTTL)try{ws.close(4002,'connection_expired');}catch{}}
    this.publish();if(this.ctx.getWebSockets().length||this.ctx.storage.sql.exec('SELECT uid FROM claims LIMIT 1').toArray().length)await this.ctx.storage.setAlarm(now+15000);
  }
}
