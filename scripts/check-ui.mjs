import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {BASE} from './ws-client.mjs';
import {accountFixture} from './fixtures.mjs';
import {GAMES} from '../catalog.js';
const browser=await chromium.launch({headless:true}),pages=[],errors=[],results=[];
const sizes=[{width:1180,height:820},{width:820,height:1180},{width:390,height:844}];
const tableState=p=>p.evaluate(async()=> (await import('/table-client.js')).tableReady.then(t=>t.channel.state));
const legacy=(p,g)=>p.evaluate(async g=>{const s=await import('/sync.js');return (await s.get(s.ref(s.db,`${g}/table-3`))).val();},g);
async function wait(p,fn,label){const end=Date.now()+15000;while(Date.now()<end){if(await fn())return;await p.waitForTimeout(60);}throw Error(`UI timeout: ${label}`);}
async function layout(p,label){for(const size of sizes){await p.setViewportSize(size);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${label}: horizontal overflow ${size.width}`);await p.screenshot({path:`.wrangler/test-results/${label}-${size.width}.png`});}await p.setViewportSize(sizes[0]);}
async function goLobby(p){if(p.url().startsWith(BASE)&&new URL(p.url()).pathname==='/'&&await p.locator('.table-card').count())return;await p.goto(BASE);await p.locator('.table-card').first().waitFor();}
async function enter(p,g,mode='sit'){await goLobby(p);await p.locator(`[data-game="${g.id}"]`).click();await p.locator('[data-table="table-3"] [data-mode="'+mode+'"]').click();await p.locator('#back-to-lobby').waitFor();}
async function leave(p){if(new URL(p.url()).searchParams.has('table'))await p.locator('#back-to-lobby').click();await p.locator('.table-card').first().waitFor();}
try{
  await mkdir('.wrangler/test-results',{recursive:true});
  for(let i=0;i<4;i++){
    const {client,identity}=await accountFixture(`ui-${i}`);client.close();
    const context=await browser.newContext({viewport:sizes[0]}),p=await context.newPage();pages.push(p);
    await p.addInitScript(id=>localStorage.setItem('eshiritori.identity',JSON.stringify(id)),identity);
    p.on('pageerror',e=>errors.push(`${p.url()}: ${e.message}`));p.on('console',e=>{if(e.type()==='error')errors.push(`${p.url()}: ${e.text()}`);});
    p.on('dialog',d=>{errors.push(`${p.url()}: ${d.message()}`);d.dismiss();});
    await p.addInitScript(()=>window.addEventListener('syncerror',e=>console.error('syncerror:',e.detail.message)));
    await goLobby(p);
    if(await p.locator('#profile-dialog').isVisible()){await p.locator('#profile-name-input').fill(['Alice','Bob','Carol','Observer'][i]);await p.locator('#register-profile-btn').click();}
    await p.locator('#profile-dialog').waitFor({state:'hidden'});
  }
  const [a,b,c,observer]=pages;
  const identityB=await b.evaluate(()=>JSON.parse(localStorage.getItem('eshiritori.identity')));
  await a.evaluate(async code=>(await import('/sync.js')).addFriend(code),identityB.friendCode);
  for(const g of GAMES){await a.locator(`[data-game="${g.id}"]`).click();assert.equal(await a.locator('.table-card').count(),6);await layout(a,`lobby-${g.path}`);}
  await a.reload();await a.locator(`[data-game="${GAMES.at(-1).id}"][aria-selected="true"]`).waitFor();
  const interaction=await a.evaluate(()=>{const body=new Event('contextmenu',{bubbles:true,cancelable:true}),input=new Event('contextmenu',{bubbles:true,cancelable:true}),gesture=new Event('gesturestart',{cancelable:true});document.body.dispatchEvent(body);document.querySelector('input').dispatchEvent(input);document.dispatchEvent(gesture);return [body.defaultPrevented,input.defaultPrevented,gesture.defaultPrevented,getComputedStyle(document.body).userSelect,getComputedStyle(document.querySelector('input')).userSelect];});
  assert.deepEqual(interaction,[true,false,true,'none','text']);
  results.push('42 tables; remembered tabs; 3 viewports; editable inputs / blocked page gestures');
  for(const g of GAMES){
    const players=g.minimum===3?[a,b,c]:[a,b];
    for(const p of players)await enter(p,g);
    await wait(a,async()=> (await tableState(a)).meta.seats.filter(Boolean).length===players.length,'seats');
    if(g.key==='eshiritori'){
      await leave(b);await a.locator('#table-invite-button').click();await a.locator('.table-friends button').getByText('招待',{exact:true}).click();
      await b.locator('#invite-modal').waitFor({state:'visible'});assert((await b.locator('#invite-modal-text').innerText()).includes('卓3'));
      await b.locator('#invite-accept-btn').click();await b.locator('#back-to-lobby').waitFor();await a.locator('.table-friends button').getByText('閉じる',{exact:true}).click();
      await wait(a,async()=> (await tableState(a)).meta.seats.filter(Boolean).length===players.length,'invite seat');results.push('Friend invitation: table → lobby recipient → accept → ordinary seat admission');
    }
    await layout(a,`${g.path}-waiting`);
    for(const p of players)await p.locator('#table-ready-button').click();
    await wait(a,async()=> (await tableState(a)).meta.phase==='playing','ready/start');
    await enter(observer,g,'watch');
    if(g.key==='eshiritori'||g.key==='quiz'){
      await wait(a,async()=> (await legacy(a,g.id)).status==='playing','legacy start');
      if(g.key==='eshiritori')await a.evaluate(()=>window.startDrawing());
      await a.locator('#canvas').waitFor({state:'visible'});const box=await a.locator('#canvas').boundingBox();
      await a.mouse.move(box.x+35,box.y+35);await a.mouse.down();await a.mouse.move(box.x+140,box.y+120,{steps:8});await a.mouse.up();
      await wait(b,async()=> (await legacy(b,g.id)).canvasData?.startsWith('data:image/'),'stroke peer');
      await a.waitForTimeout(150);const before=await legacy(a,g.id),round=(await tableState(a)).meta.roundId;await a.reload();await a.locator('#back-to-lobby').waitFor();const restored=await legacy(a,g.id);assert.equal((await tableState(a)).meta.roundId,round,'reconnect round');assert.equal(restored.currentIndex,before.currentIndex,'reconnect turn');assert(restored.canvasData?.startsWith('data:image/'),'reconnect canvas');
    }else if(g.key==='telephone'){
      await a.locator('#prompt-input').waitFor({state:'visible'});await a.locator('#prompt-input').fill('空飛ぶペンギン');await a.evaluate(()=>window.submitPrompt());
      await wait(b,async()=> Object.values((await legacy(b,g.id)).stepData?.step_0||{}).includes('空飛ぶペンギン'),'prompt peer');
    }else if(g.key==='typing'){
      await a.locator('#type-input').waitFor({state:'visible'});await a.waitForFunction(()=>!document.getElementById('type-input').disabled);
      await a.locator('#type-input').fill((await legacy(a,g.id)).raceText.slice(0,5));await wait(b,async()=>Object.values((await legacy(b,g.id)).players).some(p=>p.progress>0),'typing peer');
    }else if(g.key==='wordwolf'){
      for(const p of players){await p.locator('#word-cover').click();await p.locator('#ready-btn').click();}
      await b.locator('#screen-discussion.active').waitFor();
      const message=`よろしく ${Date.now()}`;await a.locator('#chat-input').fill(message);await a.locator('#screen-discussion .chat-input-area button').click();await b.locator('#chat-messages').getByText(message,{exact:false}).waitFor();
    }else if(g.key==='quizbattle'){
      await a.locator('#choice-0').waitFor();await wait(a,()=>a.locator('#choice-0').isEnabled(),'answer enabled');await a.locator('#choice-0').click();
      await wait(b,async()=> (await tableState(b)).game.answered.length===1,'answer peer');
    }else{
      await a.locator('#card-0').click();await wait(b,async()=> (await tableState(b)).game.flipped.includes(0),'card peer');await b.locator('#card-0.face-up').waitFor();
    }
    await layout(a,`${g.path}-playing`);await layout(observer,`${g.path}-spectator`);
    for(const p of [observer,...players])await leave(p);
    assert.equal(await a.locator('.seat-circle').count(),g.capacity*6,'all empty seat circles survive removal deltas');
    results.push(`${g.path}: lobby → sit → ready → start → UI action → peer, observer and 3 viewport layouts`);console.log(`PASS ${results.at(-1)}`);
  }
  await a.evaluate(()=>navigator.serviceWorker.ready);
  const cache=await a.evaluate(async()=> (await (await caches.open('eshiritori-v3')).keys()).map(r=>new URL(r.url).pathname));assert(cache.includes('/table-client.js')&&cache.includes('/word-wolf/app.js')&&!cache.includes('/ws'));
  assert.deepEqual(errors,[]);await writeFile('.wrangler/test-results/ui-results.json',JSON.stringify({base:BASE,results,errors},null,2));
  console.log('PASS UI: all 7 games; lobby/waiting/playing/spectator at 1180×820, 820×1180, 390×844; overflow 0; console errors 0; PWA cache');
}catch(e){console.error('UI errors:',errors);throw e;}finally{
  for(const p of pages)if(new URL(p.url()).searchParams.has('table'))try{await p.evaluate(async()=>{const t=await (await import('/table-client.js')).tableReady;await t.channel.send({op:'leave'});});}catch{}
  await browser.close();
}
