import {ready,db,ref,get,update,onValue,remove,addFriend,connectLobby,onReady} from './sync.js';
import {GAMES} from './catalog.js';
const account=await ready;
const $=id=>document.getElementById(id);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let selected=GAMES.find(g=>g.id===localStorage.getItem('eshiritori.game'))||GAMES[0],state;
const lobby=connectLobby();
function render(){
  $('game-tabs').innerHTML=GAMES.map(g=>`<button role="tab" data-game="${g.id}" aria-selected="${g.id===selected.id}">${g.name}</button>`).join('');
  $('game-description').textContent=selected.description;
  if(!state)return;
  $('table-grid').innerHTML=state.tables.filter(t=>t.game===selected.id).map(t=>{
    const count=t.seats.filter(Boolean).length,playing=t.phase==='playing',full=count>=t.capacity;
    return `<article class="table-card" data-table="${t.code}"><div class="table-card-head"><strong class="table-number">卓${t.number}</strong><span class="table-count">${count}/${t.capacity}</span><span class="table-status ${playing?'playing':full?'full':''}">${playing?'対戦中':full?'満席':'待機中'}</span></div><div class="table-seats">${t.seats.map(s=>`<div class="seat"><span class="seat-circle ${s?'occupied':''}">${s?escape([...s.name][0]):''}</span><span class="seat-name">${s?escape(s.name):'　'}</span></div>`).join('')}</div><div class="table-actions">${!playing&&!full?'<button data-mode="sit">座る</button>':''}${playing?'<button data-mode="watch">観戦</button>':''}</div></article>`;
  }).join('');
  $('lobby-messages').innerHTML=state.chat.map(m=>`<div class="lobby-message"><strong>${escape(m.name)}：</strong>${escape(m.text)}</div>`).join('');
  $('lobby-messages').scrollTop=$('lobby-messages').scrollHeight;
}
onReady(async()=>{
  const profile=(await get(ref(db,`users/${account.uid}`))).val();
  if(!profile.name)$('profile-dialog').showModal();else localStorage.setItem('username',profile.name);
  $('display-username').textContent=profile.name||'';$('display-friendcode').textContent=account.friendCode;
  $('profile-form').onsubmit=async e=>{e.preventDefault();const name=$('profile-name-input').value.trim();await update(ref(db,`users/${account.uid}`),{name});localStorage.setItem('username',name);$('display-username').textContent=name;$('profile-dialog').close();};
  $('game-tabs').onclick=e=>{const button=e.target.closest('[data-game]');if(!button)return;selected=GAMES.find(g=>g.id===button.dataset.game);localStorage.setItem('eshiritori.game',selected.id);render();};
  $('table-grid').onclick=e=>{const button=e.target.closest('[data-mode]');if(!button)return;if(!localStorage.getItem('username')){$('profile-dialog').showModal();return;}const card=button.closest('[data-table]');location.href=`/${selected.path}/?table=${card.dataset.table}&mode=${button.dataset.mode}`;};
  $('lobby-chat-form').onsubmit=async e=>{e.preventDefault();const text=$('lobby-chat-input').value.trim();if(!text)return;await lobby.send({op:'lobbyChat',text});$('lobby-chat-input').value='';};
  $('friends-open').onclick=()=>$('friends-dialog').showModal();$('friends-close').onclick=()=>$('friends-dialog').close();
  $('display-friendcode-badge').onclick=()=>navigator.clipboard.writeText(account.friendCode);
  $('edit-profile-btn').onclick=()=>{$('profile-name-input').value=localStorage.getItem('username')||'';$('friends-dialog').close();$('profile-dialog').showModal();};
  $('friend-form').onsubmit=async e=>{e.preventDefault();await addFriend($('friend-code-input').value.trim().toUpperCase());$('friend-code-input').value='';};
  onValue(ref(db,`users/${account.uid}/friends`),async snap=>{
    const ids=Object.keys(snap.val()||{});const friends=await Promise.all(ids.map(async id=>({id,...(await get(ref(db,`users/${id}`))).val()})));
    $('friends-list').innerHTML=friends.map(f=>`<div class="friend-item">${escape(f.name)}</div>`).join('');
  });
  onValue(ref(db,`users/${account.uid}/invites`),snap=>{
    const entries=Object.entries(snap.val()||{});if(!entries.length)return;const [key,invite]=entries.at(-1);
    if(Date.now()-invite.timestamp>60000){remove(ref(db,`users/${account.uid}/invites/${key}`));return;}
    const game=GAMES.find(g=>g.key===invite.gameType);if(!game)return;const table=invite.tableId||invite.roomId;
    $('invite-modal-text').textContent=`${invite.fromName} さんから ${game.name} 卓${table.split('-').at(-1)} への招待`;
    if(!$('invite-modal').open)$('invite-modal').showModal();
    const dismiss=async()=>{await remove(ref(db,`users/${account.uid}/invites/${key}`));$('invite-modal').close();};
    $('invite-decline-btn').onclick=dismiss;$('invite-accept-btn').onclick=async()=>{await dismiss();location.href=`/${game.path}/?table=${table}&mode=sit`;};
  });
  lobby.onState(next=>{state=next;render();});render();
});
