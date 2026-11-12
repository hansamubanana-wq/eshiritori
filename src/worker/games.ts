import { assert } from './wire';
import { wordPairs, ALL_QUESTIONS, EMOJI_POOL } from './game-data';
export const SECURE = new Set(['word-wolf-rooms', 'quiz-battle-rooms', 'memory-card-rooms']);
const random = (n: number) => { const max = 0x100000000 - 0x100000000 % n; let v: number; do { v = crypto.getRandomValues(new Uint32Array(1))[0]; } while (v >= max); return v % n; };
const shuffle = <T>(a:T[]) => { const b = [...a]; for (let i=b.length-1;i>0;i--) { const j=random(i+1); [b[i],b[j]]=[b[j],b[i]]; } return b; };
export function startGame(game:string, players:Record<string, any>, now:number) {
  const ids=Object.keys(players), p=Object.fromEntries(ids.map(id=>[id,{ name:players[id].name, score:0 }]));
  if (game==='word-wolf-rooms') {
    const pair=wordPairs[random(wordPairs.length)], wolf=ids[random(ids.length)];
    for (const id of ids) Object.assign(p[id], { role:id===wolf?'wolf':'citizen', word:id===wolf?pair.wolf:pair.common, ready:false, vote:'' });
    return { phase:'word_reveal', players:p, wordPair:pair, order:ids } as any;
  }
  if (game==='quiz-battle-rooms') return { phase:'question', players:p, questions:shuffle(ALL_QUESTIONS).slice(0,10), currentQuestion:0, questionStartTime:now+1000, answers:{}, revealed:false, order:ids };
  const pool=shuffle(EMOJI_POOL).slice(0,15);
  return { phase:'playing', players:p, cards:shuffle([...pool,...pool]).map((emoji,id)=>({id,emoji,matchedBy:'',faceUp:false})), flipped:[], currentTurnIdx:0, turnOrder:ids };
}
export function act(game:string, s:any, id:string, action:string, payload:any, now:number, host:string) {
  assert(s.players[id], 'not_seated');
  if (game==='word-wolf-rooms') {
    if (action==='confirmWord') {
      assert(s.phase==='word_reveal','wrong_phase'); s.players[id].ready=true;
      if(Object.values(s.players).every((p:any)=>p.ready)) {s.phase='discussion';s.discussionEndTime=now+180000;}
    } else if(action==='vote') {
      assert(s.phase==='voting'&&Object.hasOwn(s.players,payload.target)&&payload.target!==id&&!s.players[id].vote,'invalid_vote');
      s.players[id].vote=payload.target;
      if(Object.values(s.players).every((p:any)=>p.vote)) s.resultAt=now+1500;
    } else throw new Error('invalid_action');
  } else if(game==='quiz-battle-rooms') {
    if(action==='answer') {
      const elapsed=(now-s.questionStartTime)/1000;
      assert(s.phase==='question'&&!s.revealed&&elapsed>=0&&elapsed<12&&!Object.hasOwn(s.answers,id)&&Number.isInteger(payload.choice)&&payload.choice>=0&&payload.choice<4,'invalid_answer');
      s.answers[id]=payload.choice;
      if(payload.choice===s.questions[s.currentQuestion].a) s.players[id].score+=Math.max(10,Math.round(100-elapsed/12*90));
      if(Object.keys(s.answers).length===Object.keys(s.players).length) s.revealed=true;
    } else if(action==='next') {
      assert(id===host&&s.phase==='question'&&s.revealed,'forbidden');
      s.currentQuestion++;
      if(s.currentQuestion>=s.questions.length) s.phase='result';
      else {s.questionStartTime=now+500;s.answers={};s.revealed=false;}
    } else throw new Error('invalid_action');
  } else {
    assert(action==='flip'&&s.phase==='playing'&&s.turnOrder[s.currentTurnIdx]===id&&!s.resolveAt,'not_your_turn');
    const i=payload.index; assert(Number.isInteger(i)&&i>=0&&i<s.cards.length&&!s.cards[i].matchedBy&&!s.flipped.includes(i),'invalid_card');
    s.flipped.push(i);
    if(s.flipped.length===2) {
      const [a,b]=s.flipped;
      if(s.cards[a].emoji===s.cards[b].emoji) {
        for(const k of [a,b]) {s.cards[k].matchedBy=id;s.cards[k].faceUp=true;}
        s.players[id].score++;s.flipped=[];
        if(s.cards.every((c:any)=>c.matchedBy)) s.phase='result';
      } else s.resolveAt=now+1200;
    }
  }
}
export function tick(game:string,s:any,now:number) {
  if(!s) return;
  if(game==='word-wolf-rooms') {
    if(s.phase==='discussion'&&s.discussionEndTime<=now) s.phase='voting';
    if(s.phase==='voting'&&s.resultAt&&s.resultAt<=now) {
      s.phase='result';const votes:Record<string,number>={};
      for(const p of Object.values(s.players) as any[]) votes[p.vote]=(votes[p.vote]||0)+1;
      const target=Object.keys(votes).sort((a,b)=>votes[b]-votes[a])[0];s.citizensWin=s.players[target]?.role==='wolf';
    }
  } else if(game==='quiz-battle-rooms'&&s.phase==='question'&&now>=s.questionStartTime+12000) s.revealed=true;
  else if(game==='memory-card-rooms'&&s.resolveAt&&now>=s.resolveAt) {s.resolveAt=0;s.flipped=[];s.currentTurnIdx=(s.currentTurnIdx+1)%s.turnOrder.length;}
}
export function nextTick(game:string,s:any):number|undefined {
  if(!s) return;
  if(game==='word-wolf-rooms') return s.phase==='discussion'?s.discussionEndTime:s.phase==='voting'?s.resultAt:undefined;
  if(game==='quiz-battle-rooms') return s.phase==='question'&&!s.revealed?s.questionStartTime+12000:undefined;
  return s.resolveAt||undefined;
}
export function project(game:string,s:any,id:string|null) {
  if(!s) return null;
  const players:any=Object.fromEntries(Object.entries(s.players).map(([pid,p]:any)=>[pid,{name:p.name,score:p.score}]));
  if(game==='word-wolf-rooms') {
    for(const [pid,p] of Object.entries(s.players) as any) {
      Object.assign(players[pid],{ready:p.ready,voted:!!p.vote});
      if(pid===id||s.phase==='result') Object.assign(players[pid],{role:p.role,word:p.word,vote:p.vote});
    }
    return {phase:s.phase,players,discussionEndTime:s.discussionEndTime||0,...(s.phase==='result'?{wordPair:s.wordPair,citizensWin:s.citizensWin}:{})};
  }
  if(game==='quiz-battle-rooms') {
    const q=s.questions[s.currentQuestion];
    return {phase:s.phase,players,currentQuestion:s.currentQuestion,total:s.questions.length,questionStartTime:s.questionStartTime,revealed:s.revealed,
      ...(q?{question:{q:q.q,opts:q.opts,...(s.revealed?{a:q.a}:{})}}:{}),
      answered:Object.keys(s.answers),...(id&&Object.hasOwn(s.answers,id)?{myAnswer:s.answers[id]}:{})};
  }
  return {phase:s.phase,players,turnOrder:s.turnOrder,currentTurnIdx:s.currentTurnIdx,flipped:s.flipped,
    cards:s.cards.map((c:any)=>({id:c.id,matchedBy:c.matchedBy,faceUp:!!c.matchedBy||s.flipped.includes(c.id),...(c.matchedBy||s.flipped.includes(c.id)?{emoji:c.emoji}:{})}))};
}
