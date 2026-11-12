import assert from 'node:assert/strict';
import {Client,BASE,until} from './ws-client.mjs';
import {GAMES} from '../catalog.js';
import {accountFixture} from './fixtures.mjs';
const clients=[],accounts=[],identities=[];
const open=async(game,code,identity,account)=>{const c=await Client.open(game,code,undefined,undefined,{identity,account});clients.push(c);await c.auth(identity);return c;};
const cmd=(c,action,payload={},operationId=crypto.randomUUID().replaceAll('-',''))=>c.request('command',{roundId:c.state.meta.roundId,operationId,action,payload});
function secretCheck(game,id,v){
  if(!v?.game)return;const s=v.game;
  if(game==='word-wolf-rooms'&&s.phase!=='result'){
    assert.equal(s.wordPair,undefined);for(const[pid,p]of Object.entries(s.players))if(pid!==id){assert.equal(p.role,undefined);assert.equal(p.word,undefined);assert.equal(p.vote,undefined);}
  }
  if(game==='quiz-battle-rooms'){assert.equal(s.questions,undefined);if(!s.revealed)assert.equal(s.question?.a,undefined);assert.equal(s.answers,undefined);}
  if(game==='memory-card-rooms')for(const c of s.cards)if(!c.faceUp)assert.equal(c.emoji,undefined);
}
function frameCheck(game,id,frames){
  let view=null;
  for(const f of frames){if(f.value?.meta)secretCheck(game,id,f.value);if(f.tableState){view=structuredClone(f.tableState);secretCheck(game,id,view);}
    if(f.tablePatch)for(const[path,value]of f.tablePatch){if(!path.length)view=structuredClone(value);else{let n=view;for(const k of path.slice(0,-1)){n[k]??={};n=n[k];}if(value===null)delete n[path.at(-1)];else n[path.at(-1)]=structuredClone(value);}secretCheck(game,id,view);}
  }
}
try{
  for(let i=0;i<4;i++){const {client:a,identity:id}=await accountFixture(`table-${i}`);clients.push(a);accounts.push(a);identities.push(id);await a.request('update',{path:`users/${id.uid}`,value:{name:['Alice','Bob','Carol','Observer'][i]}});}
  const lobby=await open('lobby','main',identities[0],accounts[0]);await lobby.request('watchLobby');assert.equal(lobby.state.tables.length,42);
  assert(lobby.state.tables.every(t=>t.code.match(/^table-[1-6]$/)&&!('state'in t)&&!('nonce'in t)));
  await assert.rejects(Client.open('rooms','not-a-fixed-table'),/400/);
  for(const game of GAMES){
    const code='table-6',root=`${game.id}/${code}`,seated=[],observers=[];
    for(let i=0;i<(game.minimum===3?3:2);i++){const c=await open(game.id,code,identities[i],accounts[i]);await c.request('watchTable');await c.request('sit');seated.push(c);}
    await until(()=>lobby.state.tables.find(t=>t.game===game.id&&t.code===code).seats.filter(Boolean).length===seated.length,'lobby summary');
    const stranger=await open(game.id,code,identities[3],accounts[3]);observers.push(stranger);
    await assert.rejects(stranger.request('get',{path:root}),/use_game_commands|not_observing/);
    await stranger.request('watchTable');
    const other=await open(game.id,'table-5',identities[0],accounts[0]);
    await other.request('watchTable');await assert.rejects(other.request('sit'),/already_seated/);await other.request('leave');other.close();
    await seated[0].request('tableChat',{text:'table message'});await until(()=>stranger.state.chat.some(m=>m.text==='table message'),'table chat');
    await assert.rejects(cmd(seated[0],'ready',{ready:'x'.repeat(2000)}),/invalid_payload/);
    for(const c of seated)await cmd(c,'ready');await until(()=>seated.every(c=>c.state.meta.phase==='playing'),'all ready start');
    const actor=seated[0],peer=seated[1];
    if(game.key==='eshiritori'){
      await actor.request('update',{path:root,value:{status:'playing',currentIndex:0}});
      await actor.request('update',{path:root,value:{canvasData:'data:image/png;base64,AAAA'}});
      assert.equal((await peer.request('get',{path:root})).canvasData,'data:image/png;base64,AAAA');
    }else if(game.key==='quiz'){
      await actor.request('update',{path:root,value:{status:'playing',drawerId:identities[0].uid,currentWord:'ねこ',timerEnd:Date.now()+60000}});
      await actor.request('update',{path:root,value:{canvasData:'data:image/png;base64,AAAA'}});
      assert.equal((await peer.request('get',{path:root})).canvasData,'data:image/png;base64,AAAA');
    }else if(game.key==='telephone'){
      await actor.request('update',{path:root,value:{status:'playing',currentStep:0,stepData:''}});
      await actor.request('update',{path:root,value:{[`players/${identities[0].uid}/submitted`]:true,[`stepData/step_0/${identities[0].uid}`]:'ねこ'}});
      assert.equal((await peer.request('get',{path:root})).stepData.step_0[identities[0].uid],'ねこ');
    }else if(game.key==='typing'){
      await actor.request('update',{path:root,value:{phase:'racing',raceText:'あいうえお',startTime:Date.now()}});
      await actor.request('update',{path:`${root}/players/${identities[0].uid}`,value:{progress:.4}});
      assert.equal((await peer.request('get',{path:root})).players[identities[0].uid].progress,.4);
    }else{
      for(const c of [actor,stranger])for(const op of ['set','update'])await assert.rejects(c.request(op,{path:`${root}/players/${identities[0].uid}`,value:{score:999999}}),/use_game_commands/);
      await assert.rejects(actor.request('subscribe',{path:root,sub:'leak'}),/use_game_commands/);
      await assert.rejects(cmd(stranger,'ready'),/not_seated/);
      await assert.rejects(actor.request('command',{roundId:'old-round',operationId:crypto.randomUUID(),action:'ready',payload:{}}),/stale_round/);
      if(game.key==='wordwolf'){
        assert(actor.state.game.players[identities[0].uid].word);assert.equal(stranger.state.game.players[identities[0].uid].word,undefined);
        await cmd(actor,'confirmWord');await until(()=>peer.state.game.players[identities[0].uid].ready,'word confirmation');
      }else if(game.key==='quizbattle'){
        await until(()=>Date.now()>=actor.state.game.questionStartTime,'question starts');
        const id=crypto.randomUUID(),roundId=actor.state.meta.roundId,args={roundId,operationId:id,action:'answer',payload:{choice:0}};
        await actor.request('command',args);const score=actor.state.game.players[identities[0].uid].score;await actor.request('command',args);
        assert.equal(actor.state.game.players[identities[0].uid].score,score);await until(()=>peer.state.game.answered.includes(identities[0].uid),'answer shared');
        await assert.rejects(cmd(actor,'answer',{choice:1,score:9999}),/invalid_payload/);
      }else{
        const id=crypto.randomUUID(),args={roundId:actor.state.meta.roundId,operationId:id,action:'flip',payload:{index:0}};
        await actor.request('command',args);await actor.request('command',args);
        await until(()=>peer.state.game.flipped.includes(0),'flip shared');assert.equal(peer.state.game.flipped.length,1);
        assert(peer.state.game.cards[0].emoji);assert.equal(stranger.state.game.cards[1].emoji,undefined);
      }
      for(const c of [...seated,stranger])frameCheck(game.id,c===stranger?identities[3].uid:identities[seated.indexOf(c)].uid,c.frames);
    }
    for(const c of [...seated,...observers]){await c.request('leave');c.close();}
    console.log(`PASS ${game.path}: lobby → sit → ready → start → action → peer; spectator/score/one-table restrictions`);
  }
  await accounts[0].request('addFriend',{code:identities[1].friendCode});
  const a=await open('rooms','table-6',identities[0],accounts[0]);await a.request('watchTable');await a.request('sit');
  await accounts[0].request('invite',{to:identities[1].uid,gameType:'eshiritori',roomId:'table-6'});
  assert(Object.values(await accounts[1].request('get',{path:`users/${identities[1].uid}/invites`})).some(i=>i.tableId==='table-6'));
  const recipient=await open('rooms','table-5',identities[1],accounts[1]);await recipient.request('watchTable');await recipient.request('sit');
  const invited=await open('rooms','table-6',identities[1],accounts[1]);await invited.request('watchTable');await assert.rejects(invited.request('sit'),/already_seated/);
  await recipient.request('leave');recipient.close();await invited.request('leave');invited.close();
  await a.request('leave');a.close();
  await lobby.request('lobbyChat',{text:'lobby message'});await until(()=>lobby.state.chat.some(m=>m.text==='lobby message'),'lobby chat');
  console.log('PASS fixed 42-table catalog, lobby/table chat, friend table invite, projections and every raw private delta');
}finally{for(const c of clients){try{if(c.state?.meta)await c.request('leave');}catch{}c.close();}}
