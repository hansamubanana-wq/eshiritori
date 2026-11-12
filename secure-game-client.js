import {tableReady,onTableState,command,escape} from './table-client.js';
const table=await tableReady,uid=table.account.uid,$=id=>document.getElementById(id);let current,lastQuestion=-1,revealedRound='';
const show=id=>{document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));$(`screen-${id}`)?.classList.add('active');};
const scores=(players,cls='score-row')=>Object.entries(players).sort(([,a],[,b])=>b.score-a.score).map(([id,p])=>`<div class="${cls}"><span>${escape(p.name)}${id===uid?' 👈':''}</span><span>${p.score}</span></div>`).join('');
function render(state){
  current=state;const s=state.game,mine=state.meta.seats.some(p=>p?.uid===uid);
  document.querySelector('.table-chat-panel').hidden=table.game.key==='wordwolf'&&s?.phase==='discussion';
  if(table.game.key==='wordwolf'&&s?.phase==='discussion')document.querySelectorAll('#screen-discussion .chat-container input,#screen-discussion .chat-container button').forEach(el=>el.disabled=false);
  if(!s){show('lobby');$('lobby-players-list').innerHTML=state.meta.seats.filter(Boolean).map(p=>`<div>${escape(p.name)}</div>`).join('');return;}
  if(s.phase==='result'){
    show('result');if($('result-leaderboard'))$('result-leaderboard').innerHTML=scores(s.players,'leaderboard-row');
    if(table.game.key==='wordwolf'){
      $('result-title').textContent=s.citizensWin?'市民の勝ち！':'ウルフの勝ち！';$('result-winner-badge').textContent='';
      $('result-word-reveal').innerHTML=`<div>市民：${escape(s.wordPair.common)}</div><div>ウルフ：${escape(s.wordPair.wolf)}</div>`;
      $('result-players-list').innerHTML=Object.values(s.players).map(p=>`<div class="result-player-row">${escape(p.name)} ${p.role==='wolf'?'ウルフ':'市民'}</div>`).join('');
    }return;
  }
  if(table.game.key==='wordwolf'){
    show(s.phase);const me=s.players[uid];
    if(s.phase==='word_reveal'){
      if(revealedRound!==state.meta.roundId){$('word-cover').style.display=mine?'flex':'none';$('word-display').style.display='none';$('ready-btn').style.display='none';}
      $('player-ready-list').innerHTML=Object.values(s.players).map(p=>`<div>${p.ready?'✅':'⬜'} ${escape(p.name)}</div>`).join('');
      $('waiting-others').textContent=mine?'':'観戦';
    }
    if(s.phase==='discussion'){
      $('reminder-word').textContent=me?.word||'';$('discussion-players-list').innerHTML=Object.values(s.players).map(p=>`<div class="player-chip">${escape(p.name)}</div>`).join('');
    }
    if(s.phase==='voting'){
      $('vote-reminder-word').textContent=me?.word||'';$('voting-players-list').innerHTML=Object.entries(s.players).filter(([id])=>id!==uid).map(([id,p])=>`<button class="vote-card" data-vote="${id}" ${!mine||me?.vote?'disabled':''}>${escape(p.name)}</button>`).join('');
      $('voting-players-list').onclick=e=>{const b=e.target.closest('[data-vote]');if(b)command('vote',{target:b.dataset.vote});};
      $('vote-status').textContent=`${Object.values(s.players).filter(p=>p.voted).length} / ${Object.keys(s.players).length} 人が投票済み`;
    }
  }else if(table.game.key==='quizbattle'){
    show('question');$('q-num').textContent=s.currentQuestion+1;$('q-total').textContent=s.total;$('question-text').textContent=s.question.q;
    const disabled=!mine||s.answered.includes(uid)||s.revealed||Date.now()<s.questionStartTime;
    $('choices-grid').innerHTML=s.question.opts.map((text,i)=>`<button id="choice-${i}" class="choice-btn ${s.revealed&&i===s.question.a?'reveal-correct':''}" data-choice="${i}" ${disabled?'disabled':''}>${'ABCD'[i]}. ${escape(text)}</button>`).join('');
    $('choices-grid').onclick=e=>{const b=e.target.closest('[data-choice]');if(b)command('answer',{choice:Number(b.dataset.choice)});};
    $('answer-reveal-area').style.display=s.revealed?'block':'none';$('answer-reveal-area').textContent=s.revealed?`正解は「${s.question.opts[s.question.a]}」でした。`:'';
    $('next-question-btn').style.display=s.revealed&&state.meta.hostId===uid?'block':'none';$('next-question-btn').onclick=()=>command('next');$('score-list').innerHTML=scores(s.players);
  }else{
    show('playing');const turn=s.turnOrder[s.currentTurnIdx],mineTurn=turn===uid;
    $('turn-indicator').textContent=`${s.players[turn].name} の番`;$('turn-indicator').className=`turn-indicator ${mineTurn?'my-turn':''}`;
    $('remaining-pairs').textContent=15-s.cards.filter(c=>c.matchedBy).length/2;
    $('card-grid').innerHTML=s.cards.map(c=>`<div role="button" class="card ${c.faceUp?'face-up':''} ${c.matchedBy?'matched':''}" id="card-${c.id}" data-card="${c.id}" aria-disabled="${!mineTurn||c.faceUp}" >${c.faceUp?`<span class="card-emoji">${escape(c.emoji)}</span>`:''}</div>`).join('');
    $('card-grid').onclick=e=>{const card=e.target.closest('[data-card]');if(card&&mineTurn&&card.getAttribute('aria-disabled')==='false')command('flip',{index:Number(card.dataset.card)});};
    $('score-list').innerHTML=scores(s.players,'player-score-row');
  }
}
window.revealWord=()=>{const me=current.game?.players[uid];if(!me?.word)return;revealedRound=current.meta.roundId;$('word-cover').style.display='none';$('word-display').style.display='block';$('your-word-text').textContent=me.word;$('role-badge').textContent=me.role==='wolf'?'ウルフ':'市民';$('ready-btn').style.display=me.ready?'none':'inline-block';};
window.markReady=async()=>{await command('confirmWord');$('ready-btn').style.display='none';};
window.castVote=target=>command('vote',{target});window.submitAnswer=choice=>command('answer',{choice});window.hostNextQuestion=()=>command('next');window.flipCard=index=>command('flip',{index});
window.sendChat=async()=>{const input=$('chat-input'),text=input.value.trim();if(text){await table.channel.send({op:'tableChat',text});input.value='';}};
onTableState(state=>{render(state);if(table.game.key==='wordwolf'&&$('chat-messages'))$('chat-messages').innerHTML=state.chat.map(m=>`<div class="message"><strong>${escape(m.name)}：</strong>${escape(m.text)}</div>`).join('');});
setInterval(()=>{
  const s=current?.game;if(!s)return;
  if(table.game.key==='wordwolf'&&s.phase==='discussion'){$('timer-value').textContent=`${Math.floor(Math.max(0,s.discussionEndTime-Date.now())/60000)}:${String(Math.floor(Math.max(0,s.discussionEndTime-Date.now())/1000)%60).padStart(2,'0')}`;}
  if(table.game.key==='quizbattle'&&s.phase==='question'){
    $('timer-circle').textContent=Math.max(0,Math.ceil((s.questionStartTime+12000-Date.now())/1000));
    const mine=current.meta.seats.some(p=>p?.uid===uid);document.querySelectorAll('.choice-btn').forEach(button=>button.disabled=!mine||s.revealed||s.answered.includes(uid)||Date.now()<s.questionStartTime);
  }
},200);
