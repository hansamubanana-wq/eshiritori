import {Room} from './room';
import type {Env} from './index';
import {fixedTable} from '../../catalog.js';
import {assert,boundedSend,bytes,fail,LIMITS,plain,saveAttachment,type Attachment} from './wire';
import {identity,lobbyRPC} from './services';
import {SECURE,startGame,act,tick,nextTick,project} from './games';
import {diff,type Patch} from './patch';
type Seat={uid:string;name:string;ready:boolean;nonce:string;expires:number;connected:boolean;until:number};
type Meta={game:string;code:string;roundId:string;phase:string;seats:(Seat|null)[];chat:any[];ops:Record<string,string>;state:any;touched:number};
export class Table extends Room {
  protected meta!:Meta;
  private views=new Map<WebSocket,any>();
  constructor(ctx:DurableObjectState,env:Env){super(ctx,env);ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS table_state (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    const saved=ctx.storage.sql.exec<{value:string}>('SELECT value FROM table_state WHERE id = 1').toArray()[0];if(saved){this.meta=JSON.parse(saved.value);this.game=this.meta.game;this.code=this.meta.code;}
  }
  async fetch(req:Request):Promise<Response>{
    const url=new URL(req.url);
    if(url.pathname==='/member'&&req.method==='POST'){const m=await req.json<any>();return Response.json({ok:!!this.seat(m.uid)});}
    const config=fixedTable(url.searchParams.get('game'),url.searchParams.get('room'));assert(config,'invalid_table');
    if(!this.meta)this.meta={game:config.game,code:config.code,roundId:crypto.randomUUID(),phase:'waiting',seats:Array(config.capacity).fill(null),chat:[],ops:{},state:null,touched:Date.now()};
    const response=await super.fetch(req);this.game=config.game;this.code=config.code;
    return response;
  }
  private seat(id:string){return this.meta?.seats.find(s=>s?.uid===id&&s.expires>Date.now())||null;}
  private hostId(){return this.meta.seats.find(Boolean)?.uid||'';}
  private async profile(id:string,touch=false){return identity(this.env,id,touch);}
  private async lease(s:Seat,until:number){
    const r=await lobbyRPC(this.env,'renew',{uid:s.uid,game:this.game,code:this.code,nonce:s.nonce,until});if(r.ok)s.expires=r.expires;return r.ok;
  }
  private async release(s:Seat){await lobbyRPC(this.env,'release',{uid:s.uid,game:this.game,code:this.code,nonce:s.nonce});}
  private async refresh(){
    let removed=false;const now=Date.now();
    for(let i=0;i<this.meta.seats.length;i++){
      const s=this.meta.seats[i];if(!s)continue;
      const connected=this.ctx.getWebSockets().some(ws=>ws.readyState===WebSocket.OPEN&&(ws.deserializeAttachment() as any).uid===s.uid&&(ws.deserializeAttachment() as any).tableWatching);
      if(s.connected&&!connected){s.connected=false;s.until=now+(this.meta.phase==='playing'?60000:600000);}
      if(connected){s.connected=true;s.until=now+60000;}
      if(s.until<=now||!(await this.lease(s,s.until))){this.meta.seats[i]=null;await this.release(s);removed=true;}
    }
    if(removed){if(this.meta.phase==='playing')this.reset();else if(!SECURE.has(this.game))this.resetLegacy();for(const s of this.meta.seats)if(s)s.ready=false;}
  }
  private reset(){this.meta.phase='waiting';this.meta.state=null;this.meta.roundId=crypto.randomUUID();for(const s of this.meta.seats)if(s)s.ready=false;if(!SECURE.has(this.game))this.resetLegacy();}
  private resetLegacy(){
    const previous=this.data;
    const seats=this.meta.seats.filter(Boolean) as Seat[];this.host=this.hostId();this.members=Object.fromEntries(seats.map(s=>[s.uid,true]));
    const players=Object.fromEntries(seats.map(s=>[s.uid,{name:s.name,isHost:s.uid===this.host,...(this.game==='rooms-quiz'?{score:0,guessedCorrectly:false}:this.game==='rooms-telephone'?{submitted:false}:this.game==='typing-race-rooms'?{progress:0,finishTime:0,joinedAt:Date.now()}:{})}]));
    this.data=this.game==='rooms'?{status:'waiting',currentIndex:0,startChar:'あ',endChar:'ん',playersOrder:seats.map(s=>s.uid),players,gameData:[],canvasData:''}:
      this.game==='rooms-quiz'?{status:'waiting',currentIndex:0,currentWord:'',timerEnd:0,playersOrder:seats.map(s=>s.uid),players,canvasData:''}:
      this.game==='rooms-telephone'?{status:'waiting',currentStep:0,playersOrder:seats.map(s=>s.uid),players,showcaseIndex:0}:
      {phase:'lobby',hostId:this.host,createdAt:Date.now(),players};
    this.saveLegacy();
    super.broadcast(diff(previous,this.data));
  }
  private saveLegacy(){this.touched=Date.now();this.ctx.storage.sql.exec('INSERT OR REPLACE INTO room VALUES (1, ?, ?, ?, ?, ?, ?)',this.game,this.code,JSON.stringify(this.data),this.host,JSON.stringify(this.members),this.touched);}
  private async begin(){
    const config=fixedTable(this.game,this.code)!,seats=this.meta.seats.filter(Boolean) as Seat[];
    if(seats.length<config.minimum||!seats.every(s=>s.ready&&s.connected))return;
    this.meta.roundId=crypto.randomUUID();this.meta.phase='playing';
    if(SECURE.has(this.game))this.meta.state=startGame(this.game,Object.fromEntries(seats.map(s=>[s.uid,{name:s.name}])),Date.now());
    else this.resetLegacy();
  }
  private view(id:string,observing:boolean){
    const s=this.seat(id),config=fixedTable(this.game,this.code)!;
    return {meta:{...config,roundId:this.meta.roundId,phase:this.meta.phase,hostId:this.hostId(),seats:this.meta.seats.map(s=>s?{uid:s.uid,name:s.name,ready:s.ready,connected:s.connected}:null)},
      game:observing&&SECURE.has(this.game)?project(this.game,this.meta.state,s?id:null):null,chat:observing?this.meta.chat:[]};
  }
  private publishTable(){
    for(const ws of this.ctx.getWebSockets()){
      const a=ws.deserializeAttachment() as any;if(!a.tableWatching)continue;const value=this.view(a.uid,true),previous=this.views.get(ws),patches=previous?diff(previous,value):null;
      if(!previous||patches!.length)boundedSend(ws,previous?{tablePatch:patches}:{tableState:value},a,this.out);this.views.set(ws,structuredClone(value));
    }
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO outbound VALUES (1, ?, ?)',this.out.tokens,this.out.tick);
  }
  protected broadcast(patches:Patch[]){if(!SECURE.has(this.game))super.broadcast(patches);}
  protected stateBudget(){return LIMITS.room-1024*1024;}
  protected async handleMessage(ws:WebSocket,m:any){
    let a=ws.deserializeAttachment() as any;
    try{
      assert(a.uid,'unauthenticated');await this.refresh();let value:any=null;
      if(m.op==='auth'){assert(a.uid===m.uid&&!a.confirmed,'invalid_credentials');a.confirmed=true;}
      else if(m.op==='watchTable'){
        a.tableWatching=true;const s=this.seat(a.uid);if(s){s.connected=true;s.until=Date.now()+60000;assert(await this.lease(s,s.until),'seat_expired');}
        value=this.view(a.uid,true);
      } else if(m.op==='sit'){
        assert(this.meta.phase!=='playing','game_in_progress');let seat=this.seat(a.uid);
        if(!seat){
          const index=this.meta.seats.findIndex(s=>!s);assert(index>=0,'table_full');const p=await this.profile(a.uid,true);assert(p.name,'name_required');
          const claim=await lobbyRPC(this.env,'claim',{uid:a.uid,game:this.game,code:this.code});assert(claim.ok,claim.error||'already_seated');
          seat={uid:a.uid,name:p.name,ready:false,nonce:claim.nonce,expires:claim.expires,connected:true,until:Date.now()+60000};
          assert(await this.lease(seat,seat.until),'seat_expired');this.meta.seats[index]=seat;
          if(this.meta.phase==='result')this.reset();else if(!SECURE.has(this.game))this.resetLegacy();
        }
        a.tableWatching=true;
      } else if(m.op==='leave'){
        const index=this.meta.seats.findIndex(s=>s?.uid===a.uid),s=this.meta.seats[index];
        if(s){this.meta.seats[index]=null;await this.release(s);if(this.meta.phase==='playing'||this.meta.phase==='result')this.reset();else if(!SECURE.has(this.game))this.resetLegacy();for(const seat of this.meta.seats)if(seat)seat.ready=false;}
        a.tableWatching=false;a.subs={};this.views.delete(ws);
      } else if(m.op==='tableChat'){
        assert(a.tableWatching,'not_observing');assert(typeof m.text==='string'&&m.text.trim()&&m.text.length<=1000&&!/[<>\x00-\x1f]/.test(m.text),'invalid_string');
        const p=await this.profile(a.uid,true);this.meta.chat.push({uid:a.uid,name:p.name||'ゲスト',text:m.text,timestamp:Date.now()});this.meta.chat=this.meta.chat.slice(-200);
      } else if(m.op==='command'){
        const s=this.seat(a.uid);assert(s,'not_seated');assert(await this.lease(s,Date.now()+60000),'seat_expired');
        assert(typeof m.operationId==='string'&&/^[A-Za-z0-9_-]{8,80}$/.test(m.operationId),'invalid_operation_id');
        assert(typeof m.roundId==='string'&&m.roundId.length<=80,'stale_round');
        const fields:Record<string,string[]>={ready:['ready'],confirmWord:[],vote:['target'],answer:['choice'],next:[],flip:['index']};
        m.payload??={};assert(plain(m.payload)&&Object.hasOwn(fields,m.action)&&Object.keys(m.payload).every(k=>fields[m.action].includes(k)),'invalid_payload');
        if(m.action==='ready')assert(!Object.hasOwn(m.payload,'ready')||typeof m.payload.ready==='boolean','invalid_payload');
        const opKey=`${a.uid}/${m.operationId}`,fingerprint=JSON.stringify([m.roundId,m.action,m.payload||{}]);
        if(Object.hasOwn(this.meta.ops,opKey))assert(this.meta.ops[opKey]===fingerprint,'operation_reused');
        else{
          assert(m.roundId===this.meta.roundId,'stale_round');await this.profile(a.uid,true);
          if(m.action==='ready'){
            assert(this.meta.phase==='waiting'||this.meta.phase==='result','wrong_phase');s.ready=m.payload?.ready!==false;await this.begin();
          }else{
            assert(SECURE.has(this.game)&&this.meta.phase==='playing','wrong_phase');
            const next=structuredClone(this.meta.state);act(this.game,next,a.uid,m.action,m.payload||{},Date.now(),this.hostId());this.meta.state=next;
            if(next.phase==='result'){this.meta.phase='result';for(const seat of this.meta.seats)if(seat)seat.ready=false;}
          }
          this.meta.ops[opKey]=fingerprint;const keys=Object.keys(this.meta.ops);for(const k of keys.slice(0,-512))delete this.meta.ops[k];
        }
      } else if(['get','subscribe','unsubscribe','set','update','remove'].includes(m.op)){
        assert(!SECURE.has(this.game),'use_game_commands');assert(a.tableWatching,'not_observing');
        if(['set','update','remove'].includes(m.op)){
          assert(this.seat(a.uid),'not_seated');assert(this.meta.phase==='playing','not_started');
          assert(m.path!==`${this.game}/${this.code}`||m.op!=='set','forbidden');
          this.meta.touched=Date.now();
        }
        saveAttachment(ws,a);await super.handleMessage(ws,m);a=ws.deserializeAttachment();
        if(this.data?.status==='result'||this.data?.phase==='result'){this.meta.phase='result';for(const seat of this.meta.seats)if(seat)seat.ready=false;}
        await this.commit();this.publishTable();return;
      } else throw new Error('invalid_operation');
      if(['sit','leave','tableChat','command'].includes(m.op))this.meta.touched=Date.now();
      if(m.op!=='auth'&&m.op!=='watchTable')a.lastAction=Date.now();saveAttachment(ws,a);await this.commit();this.publishTable();boundedSend(ws,{id:m.id,value},ws.deserializeAttachment(),this.out);
    }catch(e){saveAttachment(ws,a);fail(ws,m.id,e);}finally{this.ctx.storage.sql.exec('INSERT OR REPLACE INTO outbound VALUES (1, ?, ?)',this.out.tokens,this.out.tick);}
  }
  private async commit(){
    const json=JSON.stringify(this.meta);assert(bytes(json)<=1024*1024,'room_too_large');
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO table_state VALUES (1, ?)',json);
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO outbound VALUES (1, ?, ?)',this.out.tokens,this.out.tick);
    const config=fixedTable(this.game,this.code)!;
    await lobbyRPC(this.env,'summary',{...config,phase:this.meta.phase,roundId:this.meta.roundId,seats:this.meta.seats.map(s=>s?{uid:s.uid,name:s.name,ready:s.ready,connected:s.connected}:null)});
    let next=Math.max(Date.now()+1000,this.meta.touched+LIMITS.ttl);
    for(const s of this.meta.seats)if(s)next=Math.min(next,s.connected?Date.now()+15000:s.until);
    const due=nextTick(this.game,this.meta.state);if(due)next=Math.min(next,due);
    if(this.ctx.getWebSockets().length)next=Math.min(next,Date.now()+30000);
    await this.ctx.storage.setAlarm(Math.max(Date.now()+1,next));
  }
  private control(fn:()=>Promise<void>){const p=this.messages.then(fn);this.messages=p.catch(()=>{});return p;}
  async webSocketClose(ws:WebSocket){this.views.delete(ws);try{ws.close();}catch{}return this.control(async()=>{if(this.meta){await this.refresh();await this.commit();this.publishTable();}});}
  async webSocketError(ws:WebSocket){await this.webSocketClose(ws);}
  async alarm(){return this.control(()=>this.maintenance());}
  private async maintenance(){
    if(!this.meta)return;await this.refresh();tick(this.game,this.meta.state,Date.now());
    if(this.meta.state?.phase==='result'){this.meta.phase='result';for(const s of this.meta.seats)if(s)s.ready=false;}
    for(const ws of this.ctx.getWebSockets()){const a=ws.deserializeAttachment() as Attachment;if(Date.now()-(a.lastAction||a.opened)>=LIMITS.idle||Date.now()-a.opened>=LIMITS.connectionTTL)try{ws.close(4002,'connection_expired');}catch{}}
    if(!this.meta.seats.some(Boolean)&&Date.now()-this.meta.touched>=LIMITS.ttl){this.reset();this.meta.chat=[];this.meta.ops={};this.meta.touched=Date.now();}
    await this.commit();this.publishTable();
  }
}
