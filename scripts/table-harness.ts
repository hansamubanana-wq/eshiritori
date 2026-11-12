// Test-only internal controls. Excluded from deployed assets and Worker entrypoint.
import worker from '../src/worker/index';
import {Lobby as ProductionLobby} from '../src/worker/lobby';
import {Table as ProductionTable} from '../src/worker/table';
import {Accounts as ProductionAccounts} from '../src/worker/accounts';
export class Accounts extends ProductionAccounts{
  async fetch(req:Request){if(new URL(req.url).pathname==='/test-forget-registration'){this.ctx.storage.sql.exec('DELETE FROM room_registry');return Response.json({ok:true});}return super.fetch(req);}
}
export {Room} from '../src/worker/room';
export class Lobby extends ProductionLobby{
  async fetch(req:Request){if(new URL(req.url).pathname==='/test-expire'){
    const m=await req.json<any>();this.ctx.storage.sql.exec('UPDATE claims SET expires = ? WHERE uid = ?',Date.now()-1,m.uid);await this.alarm();return Response.json({ok:true});
  }return super.fetch(req);}
}
export class Table extends ProductionTable{
  async fetch(req:Request){if(new URL(req.url).pathname==='/test-control'){
    const m=await req.json<any>();const self=this as any;
    if(m.advance){if(this.meta.state?.discussionEndTime)this.meta.state.discussionEndTime=Date.now()-1;if(this.meta.state?.resultAt)this.meta.state.resultAt=Date.now()-1;if(this.meta.state?.resolveAt)this.meta.state.resolveAt=Date.now()-1;if(this.meta.state?.questionStartTime)this.meta.state.questionStartTime=Date.now()-13000;}
    if(m.expire){for(const s of this.meta.seats)if(s)s.until=Date.now()-1;}
    if(m.idle){for(const ws of this.ctx.getWebSockets()){const a=ws.deserializeAttachment() as any;a.lastAction=Date.now()-16*60000;ws.serializeAttachment(a);}}
    if(m.age)this.meta.touched=Date.now()-25*3600000;
    if(m.budget){self.out={tokens:0,tick:Date.now()+60000};this.ctx.storage.sql.exec('INSERT OR REPLACE INTO outbound VALUES (1, ?, ?)',0,self.out.tick);}
    if(m.alarm)await this.alarm();
    return Response.json({state:this.meta,now:Date.now(),alarm:await this.ctx.storage.getAlarm(),out:self.out});
  }return super.fetch(req);}
}
export default worker;
