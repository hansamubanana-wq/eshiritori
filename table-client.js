import {ready,db,ref,get,connectTable,onReady,sendInvite} from './sync.js';
import {GAMES,fixedTable} from './catalog.js';
export const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let current;
export const tableReady=(async()=>{
  const game=GAMES.find(g=>location.pathname.split('/')[1]===g.path),params=new URLSearchParams(location.search),code=params.get('table');
  if(!game||!fixedTable(game.id,code)){location.replace('/');return new Promise(()=>{});}
  const account=await ready,profile=(await get(ref(db,`users/${account.uid}`))).val();if(!profile.name){location.replace('/');return new Promise(()=>{});}
  const channel=connectTable(game.id,code);await channel.connected;
  if(params.get('mode')==='sit'&&!channel.state.meta.seats.some(s=>s?.uid===account.uid)){
    try{await channel.send({op:'sit'});}catch(e){alert({already_seated:'別の卓に着席中です。',table_full:'満席です。',game_in_progress:'対戦中です。観戦します。'}[e.message]||e.message);if(e.message==='already_seated'){location.replace('/');return new Promise(()=>{});}}
  }
  await new Promise(resolve=>onReady(resolve));
  const container=document.querySelector('.container');
  const header=document.createElement('div');header.className='table-header';header.innerHTML=`<button id="back-to-lobby">ロビーへ</button><strong>${game.name} 卓${code.split('-')[1]}</strong>`;container.prepend(header);
  const panel=document.createElement('div');panel.id='table-ready-panel';panel.innerHTML='<div id="table-ready-list" class="table-ready-list"></div><button id="table-ready-button" class="table-ready">準備完了</button> <button id="table-invite-button">フレンドを招待</button>';header.after(panel);
  const chat=document.createElement('section');chat.className='table-chat-panel';chat.innerHTML='<div class="table-chat-messages" id="table-chat-messages" aria-label="卓チャット"></div><form class="table-chat-form" id="table-chat-form"><input id="table-chat-input" aria-label="卓チャットのメッセージ" maxlength="1000" autocomplete="off"><button>送信</button></form>';container.append(chat);
  document.getElementById('back-to-lobby').onclick=async()=>{await channel.send({op:'leave'});location.href='/';};
  document.getElementById('table-ready-button').onclick=()=>command('ready',{ready:!channel.state.meta.seats.find(s=>s?.uid===account.uid)?.ready});
  document.getElementById('table-chat-form').onsubmit=async e=>{e.preventDefault();const input=document.getElementById('table-chat-input'),text=input.value.trim();if(text){await channel.send({op:'tableChat',text});input.value='';}};
  document.getElementById('table-invite-button').onclick=async()=>{
    const friends=(await get(ref(db,`users/${account.uid}/friends`))).val()||{};const dialog=document.createElement('dialog');dialog.className='table-friends';
    for(const id of Object.keys(friends)){const p=(await get(ref(db,`users/${id}`))).val();if(!p)continue;const row=document.createElement('div');row.textContent=p.name+' ';const button=document.createElement('button');button.textContent='招待';button.onclick=async()=>{await sendInvite(id,{roomId:code,gameType:game.key});button.disabled=true;button.textContent='送信済';};row.append(button);dialog.append(row);}
    const close=document.createElement('button');close.textContent='閉じる';close.onclick=()=>dialog.remove();dialog.append(close);document.body.append(dialog);dialog.showModal();
  };
  current={account,channel,game,code,name:profile.name};
  channel.onState(state=>{
    const mine=state.meta.seats.find(s=>s?.uid===account.uid),waiting=state.meta.phase!=='playing';
    panel.style.display=waiting?'block':'none';document.getElementById('table-ready-list').innerHTML=state.meta.seats.filter(Boolean).map(s=>`<span>${escape(s.name)} ${s.connected?(s.ready?'準備完了':''):'切断復帰待ち'}</span>`).join('');
    const button=document.getElementById('table-ready-button');button.disabled=!mine;button.textContent=mine?.ready?'準備を取り消す':'準備完了';document.getElementById('table-invite-button').hidden=!mine;
    const messages=document.getElementById('table-chat-messages');messages.innerHTML=state.chat.map(m=>`<div><strong>${escape(m.name)}：</strong>${escape(m.text)}</div>`).join('');messages.scrollTop=messages.scrollHeight;
    if(!mine)document.querySelectorAll('.screen button,.screen input,.screen select').forEach(input=>{input.disabled=true;});
  });
  return current;
})();
export async function command(action,payload={},operationId=crypto.randomUUID().replaceAll('-','')){const t=await tableReady;return t.channel.send({op:'command',action,payload,operationId,roundId:t.channel.state.meta.roundId});}
export function onTableState(fn){let unsubscribe;tableReady.then(t=>{unsubscribe=t.channel.onState(fn);});return()=>unsubscribe?.();}
export async function bindLegacy(listen,start){const t=await tableReady;let started='';listen();onTableState(async state=>{
  if(state.meta.phase==='waiting'){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));document.getElementById('screen-lobby').classList.add('active');}
  if(state.meta.phase==='playing'&&state.meta.hostId===t.account.uid&&started!==state.meta.roundId){started=state.meta.roundId;const saved=(await get(ref(db,`${t.game.id}/${t.code}`))).val();if(saved?.status==='waiting'||saved?.phase==='lobby')start();}
});}
