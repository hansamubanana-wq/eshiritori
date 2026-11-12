import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {Client,until} from './ws-client.mjs';
const bundle=await build({entryPoints:['scripts/table-harness.ts'],bundle:true,write:false,format:'esm',platform:'neutral',external:['cloudflare:workers']});
const mf=new Miniflare(convertV4MiniflareOptions({name:'table-test',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-11-04',bindings:{PUBLIC_ORIGIN:''},durableObjects:Object.fromEntries(['Room','Accounts','Lobby','Table'].map((c,i)=>[['ROOMS','ACCOUNTS','LOBBY','TABLES'][i],{className:c,useSQLite:true}])),durableObjectsPersist:false,unsafeInspectDurableObjects:true}));
const base=(await mf.ready).origin,bindings=await mf.getBindings(),clients=[];
const open=async(game,code,identity)=>{const c=await Client.open(game,code,base,base,{identity});clients.push(c);await c.auth(identity);if(game)await c.request('watchTable');return c;};
const control=(game,code,m)=>bindings.TABLES.get(bindings.TABLES.idFromName(`${game}/${code}`)).fetch('https://internal/test-control',{method:'POST',body:JSON.stringify(m)}).then(r=>r.json());
const cmd=(c,action,payload={})=>c.request('command',{roundId:c.state.meta.roundId,operationId:crypto.randomUUID(),action,payload});
try{
  const account=await Client.open(undefined,undefined,base,base);clients.push(account);const id=await account.auth();await account.request('update',{path:`users/${id.uid}`,value:{name:'Alice'}});
  const a=await open('memory-card-rooms','table-1',id),b=await open('word-wolf-rooms','table-1',id);
  const race=await Promise.allSettled([a.request('sit'),b.request('sit')]);assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.match(race.find(r=>r.status==='rejected').reason.message,/already_seated/);
  const seated=race[0].status==='fulfilled'?a:b,game=seated===a?'memory-card-rooms':'word-wolf-rooms';await seated.request('leave');
  await a.request('sit');const oldRound=a.state.meta.roundId;a.close();
  const reconnect=await open('memory-card-rooms','table-1',id);assert(reconnect.state.meta.seats.some(s=>s?.uid===id.uid));assert.equal(reconnect.state.meta.roundId,oldRound);
  await mf.unsafeEvictDurableObject('table-test','Table',{name:'memory-card-rooms/table-1',webSockets:'hibernate'});await reconnect.request('watchTable');assert(reconnect.state.meta.seats.some(s=>s?.uid===id.uid));
  const lobby=bindings.LOBBY.get(bindings.LOBBY.idFromName('lobby'));
  await lobby.fetch('https://internal/test-expire',{method:'POST',body:JSON.stringify({uid:id.uid})});
  await b.request('sit');await reconnect.request('watchTable');assert(!reconnect.state.meta.seats.some(s=>s?.uid===id.uid),'expired old table cannot revive lease');
  await assert.rejects(reconnect.request('sit'),/already_seated/);await b.request('leave');
  console.log('PASS table leases: concurrent sit has one winner; reconnect and hibernation restore seat; expired fenced lease cannot resurrect or release a newer claim');
  const ids=[id];for(let i=0;i<2;i++){const ac=await Client.open(undefined,undefined,base,base);clients.push(ac);const uid=await ac.auth();ids.push(uid);await ac.request('update',{path:`users/${uid.uid}`,value:{name:`Player${i}`}});}
  for(const game of ['word-wolf-rooms','quiz-battle-rooms','memory-card-rooms']){
    const players=[];for(const identity of ids.slice(0,game==='word-wolf-rooms'?3:2)){const c=await open(game,'table-2',identity);await c.request('sit');players.push(c);}
    await cmd(players[0],'ready');assert.equal(players[0].state.meta.phase,'waiting','not all ready');
    for(const c of players.slice(1))await cmd(c,'ready');
    if(game==='word-wolf-rooms'){
      for(const c of players)await cmd(c,'confirmWord');await control(game,'table-2',{advance:true,alarm:true});
      await until(()=>players[0].state.game.phase==='voting','voting alarm');
      await assert.rejects(cmd(players[0],'vote',{target:'constructor'}),/invalid_vote/);
      for(let i=0;i<players.length;i++)await cmd(players[i],'vote',{target:ids[(i+1)%ids.length].uid});
      await control(game,'table-2',{advance:true,alarm:true});await until(()=>players[0].state.meta.phase==='result','wolf result');
      assert(players[0].state.game.wordPair);assert(Object.values(players[0].state.game.players).every(p=>p.role&&p.word));
    }else if(game==='quiz-battle-rooms'){
      for(let i=0;i<10;i++){await control(game,'table-2',{advance:true,alarm:true});await until(()=>players[0].state.game.revealed,'quiz timeout');await cmd(players[0],'next');}
      assert.equal(players[0].state.meta.phase,'result');assert(Object.values(players[0].state.game.players).every(p=>p.score===0));
    }else{
      const saved=await control(game,'table-2',{}),groups=new Map();saved.state.state.cards.forEach(c=>groups.set(c.emoji,[...(groups.get(c.emoji)||[]),c.id]));
      await assert.rejects(cmd(players[1],'flip',{index:0}),/not_your_turn/);
      for(const pair of groups.values())for(const index of pair)await cmd(players[0],'flip',{index});
      assert.equal(players[0].state.meta.phase,'result');assert.equal(players[0].state.game.players[id.uid].score,15);
    }
    for(const c of players){await c.request('leave');c.close();}
  }
  await reconnect.request('sit');await reconnect.request('tableChat',{text:'test',sender:'fake',name:'fake',type:'system'});assert.equal(reconnect.state.chat.at(-1).uid,id.uid);assert.equal(reconnect.state.chat.at(-1).name,'Alice');assert.equal(reconnect.state.chat.at(-1).type,undefined);
  const before=(await control('memory-card-rooms','table-1',{})).state.touched;await control('memory-card-rooms','table-1',{alarm:true});assert.equal((await control('memory-card-rooms','table-1',{})).state.touched,before,'maintenance must not keep inactive state alive');
  await reconnect.request('leave');await control('memory-card-rooms','table-1',{age:true,alarm:true});assert.equal((await control('memory-card-rooms','table-1',{})).state.chat.length,0);
  const legacy=[];for(const identity of ids.slice(0,2)){const c=await open('rooms','table-3',identity);await c.request('sit');legacy.push(c);}
  await bindings.ACCOUNTS.get(bindings.ACCOUNTS.idFromName('accounts')).fetch('https://internal/test-forget-registration');
  await account.request('addFriend',{code:ids[1].friendCode});await account.request('invite',{to:ids[1].uid,gameType:'eshiritori',roomId:'table-3'});
  for(const c of legacy)await cmd(c,'ready');await legacy[0].request('update',{path:'rooms/table-3',value:{status:'playing'}});
  assert.equal((await legacy[1].request('get',{path:'rooms/table-3'})).status,'playing');for(const c of legacy)await c.request('leave');
  console.log('PASS fixed tables remain playable/invitable after the former room reservation expires');
  const limited=await open('memory-card-rooms','table-4',id);await limited.request('sit');await control('memory-card-rooms','table-4',{idle:true,alarm:true});await until(()=>limited.socket.readyState!==1,'table idle expiry');
  const restored=await open('memory-card-rooms','table-4',id);assert(restored.state.meta.seats.some(s=>s?.uid===id.uid));await restored.request('leave');
  await control('memory-card-rooms','table-4',{budget:true});await mf.unsafeEvictDurableObject('table-test','Table',{name:'memory-card-rooms/table-4',webSockets:'hibernate'});
  await assert.rejects(restored.request('watchTable'),/send_rate_limited|closed/);
  console.log('PASS table idle disconnect and rejoin; shared outbound budget survives DO hibernation');
  console.log('PASS secure engines: full wolf/quiz/memory rounds, deadlines, server scores, turn checks, chat identity, 24-hour inactive cleanup');
}finally{for(const c of clients)c.close();await mf.dispose();}
