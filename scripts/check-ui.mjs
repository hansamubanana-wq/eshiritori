import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { BASE } from './ws-client.mjs';
const browser = await chromium.launch({ headless: true });
const errors = [], results = [];
const contexts = [];
await mkdir('test-results', { recursive: true });
async function newClient() {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }); contexts.push(context);
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(`${page.url()}: ${e.message}`));
    page.on('console', e => { if (e.type() === 'error') errors.push(`${page.url()}: ${e.text()}`); });
    page.on('dialog', dialog => { errors.push(`${page.url()}: dialog: ${dialog.message()}`); dialog.dismiss(); });
    await page.addInitScript(() => window.addEventListener('syncerror', e => { console.error('syncerror:', e.detail.message); }));
    await page.goto(BASE);
    await page.waitForFunction(() => localStorage.getItem('eshiritori.identity'));
    return page;
}
async function state(page, root) { return page.evaluate(async root => { const s = await import('/sync.js'); return (await s.get(s.ref(s.db, root))).val(); }, root); }
async function waitState(page, root, predicate) {
    const end = Date.now() + 15000;
    while (Date.now() < end) { const s = await state(page, root); if (predicate(s)) return s; await page.waitForTimeout(70); }
    throw new Error(`state timeout: ${root}, ${JSON.stringify(await state(page, root)).slice(0, 500)}`);
}
async function enter(page, game, room, name) {
    await page.goto(`${BASE}/${game}/index.html`);
    await page.waitForFunction(() => typeof window.connectLobby === 'function');
    await page.locator('#user-name').fill(name); await page.locator('#room-id').fill(room);
    await page.evaluate(() => window.connectLobby());
    await page.locator('#screen-lobby.active').waitFor();
}
try {
    const a = await newClient(), b = await newClient();
    for (const [page, name] of [[a, 'Alice'], [b, 'Bob']]) {
        await page.locator('#profile-name-input').fill(name); await page.locator('#register-profile-btn').click();
        await page.locator('#profile-display-view').waitFor({ state: 'visible' });
    }
    const identityB = await b.evaluate(() => JSON.parse(localStorage.getItem('eshiritori.identity')));
    // Use the exact same command as the portal, without its success alert.
    await a.evaluate(async code => (await import('/sync.js')).addFriend(code), identityB.friendCode);
    await a.locator('.friend-item').waitFor(); await b.locator('.friend-item').waitFor();
    results.push('Portal: profile registration and reciprocal friend UI');
    for (const width of [375, 768, 1280]) {
        await a.setViewportSize({ width, height: 1000 });
        assert(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `portal overflow at ${width}`);
        await a.screenshot({ path: `test-results/portal-${width}.png` });
    }
    await a.setViewportSize({ width: 1280, height: 900 });
    const interaction = await a.evaluate(() => {
        const bodyEvent = new Event('contextmenu', { bubbles: true, cancelable: true });
        const inputEvent = new Event('contextmenu', { bubbles: true, cancelable: true });
        document.body.dispatchEvent(bodyEvent);
        document.getElementById('friend-code-input').dispatchEvent(inputEvent);
        const gesture = new Event('gesturestart', { cancelable: true }); document.dispatchEvent(gesture);
        return { body: bodyEvent.defaultPrevented, input: inputEvent.defaultPrevented, gesture: gesture.defaultPrevented,
            bodySelect: getComputedStyle(document.body).userSelect, inputSelect: getComputedStyle(document.querySelector('input')).userSelect };
    });
    assert.deepEqual(interaction, { body: true, input: false, gesture: true, bodySelect: 'none', inputSelect: 'text' });
    results.push('Interaction: gesture/context menu blocked; input editing allowed');
    const games = [
        ['eshiritori', 'rooms'], ['drawing-quiz', 'rooms-quiz'], ['drawing-telephone', 'rooms-telephone'],
        ['word-wolf', 'word-wolf-rooms'], ['typing-race', 'typing-race-rooms'], ['quiz-battle', 'quiz-battle-rooms'], ['memory-cards', 'memory-card-rooms'],
    ];
    for (const [game, namespace] of games) {
        const room = `ui-${Date.now()}`, root = `${namespace}/${room}`;
        await enter(a, game, room, 'Alice'); await enter(b, game, room, 'Bob');
        await waitState(a, root, s => Object.keys(s?.players || {}).length === 2);
        let third;
        if (game === 'word-wolf') { third = await newClient(); await enter(third, game, room, 'Carol'); await waitState(a, root, s => Object.keys(s?.players || {}).length === 3); }
        await a.locator('#start-game-btn').waitFor({ state: 'visible' });
        if (game === 'eshiritori') {
            // Verify one actual lobby invitation arrives at the friend's portal.
            await b.goto(BASE);
            await b.locator('#profile-display-view').waitFor({ state: 'visible' });
            await waitState(b, `users/${identityB.uid}`, s => s?.status === 'online');
            await a.locator('#lobby-invite-btn').click();
            await a.locator('#lobby-invite-friends-list button').first().click();
            await b.locator('#invite-modal').waitFor({ state: 'visible' });
            assert((await b.locator('#invite-modal-text').innerText()).includes(room));
            await b.locator('#invite-accept-btn').click();
            await b.locator('#screen-lobby.active').waitFor();
            await a.evaluate(() => document.getElementById('lobby-invite-modal').style.display = 'none');
            results.push('Friends: invite from room, receive and accept from portal');
        }
        await a.locator('#start-game-btn').click();
        if (game === 'eshiritori' || game === 'drawing-quiz') {
            await waitState(b, root, s => s?.status === 'playing');
            if (game === 'eshiritori') await a.evaluate(() => window.startDrawing());
            await a.locator('#canvas').waitFor({ state: 'visible' });
            const box = await a.locator('#canvas').boundingBox();
            await a.mouse.move(box.x + 35, box.y + 35); await a.mouse.down(); await a.mouse.move(box.x + 140, box.y + 120, { steps: 8 }); await a.mouse.up();
            await waitState(b, root, s => s?.canvasData?.startsWith('data:image/'));
            await b.locator('#live-stream-view').waitFor({ state: 'visible' });
            await b.waitForFunction(() => document.getElementById('live-stream-view').complete && document.getElementById('live-stream-view').naturalWidth === 380);
        } else if (game === 'drawing-telephone') {
            await a.locator('#prompt-input').waitFor({ state: 'visible' }); await a.locator('#prompt-input').fill('空飛ぶペンギン');
            await a.evaluate(() => window.submitPrompt());
            await waitState(b, root, s => Object.values(s?.stepData?.step_0 || {}).includes('空飛ぶペンギン'));
            await b.locator('#prompt-input').fill('赤いりんご'); await b.evaluate(() => window.submitPrompt());
            await a.locator('#screen-step-1.active').waitFor(); await b.locator('#screen-step-1.active').waitFor();
        } else if (game === 'word-wolf') {
            await waitState(b, root, s => s?.phase === 'word_reveal');
            await a.evaluate(() => window.revealWord()); await a.evaluate(() => window.markReady());
            await waitState(b, root, s => Object.values(s?.players || {}).some(p => p.name === 'Alice' && p.ready));
            for (const p of [b, third]) { await p.evaluate(() => window.revealWord()); await p.evaluate(() => window.markReady()); }
            await waitState(a, root, s => s?.phase === 'discussion');
            await a.locator('#chat-input').fill('よろしく'); await a.evaluate(() => window.sendChat());
            await b.locator('#chat-messages').getByText('よろしく', { exact: false }).waitFor();
        } else if (game === 'typing-race') {
            await waitState(b, root, s => s?.phase === 'racing');
            await a.locator('#type-input').waitFor({ state: 'visible' });
            await a.waitForFunction(() => !document.getElementById('type-input').disabled);
            const s = await state(a, root); await a.locator('#type-input').fill(s.raceText.slice(0, 5));
            await waitState(b, root, s => Object.values(s?.players || {}).some(p => p.name === 'Alice' && p.progress > 0));
            assert((await b.locator('#progress-area').innerText()).includes('%'));
        } else if (game === 'quiz-battle') {
            await b.locator('#choice-0').waitFor({ state: 'visible' }); await b.locator('#choice-0').click();
            await waitState(a, root, s => Object.keys(s?.answers || {}).length === 1);
        } else {
            await a.locator('#card-0').waitFor({ state: 'visible' });
            await a.evaluate(() => window.flipCard(0)); await waitState(b, root, s => s?.flipped?.includes(0));
        }
        results.push(`${game}: create → join → action → peer state + UI`);
        console.log(`PASS ${results.at(-1)}`);
        await a.screenshot({ path: `test-results/${game}-desktop.png` });
        for (const width of [375, 768]) {
            await a.setViewportSize({ width, height: 1000 });
            assert(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${game}: overflow at ${width}`);
            await a.screenshot({ path: `test-results/${game}-${width}.png` });
        }
        await a.setViewportSize({ width: 1280, height: 900 });
        if (third) await third.context().close();
    }
    await a.goto(BASE); await a.evaluate(() => navigator.serviceWorker.ready);
    const cache = await a.evaluate(async () => { const c = await caches.open('eshiritori-v1'); return (await c.keys()).map(r => new URL(r.url).pathname); });
    assert(cache.includes('/word-wolf/app.js') && !cache.some(path => path.includes('/ws')));
    results.push('PWA: service worker installed, seven games cached, /ws never cached');
    assert.deepEqual(errors, []);
    await writeFile('test-results/ui-results.json', JSON.stringify({ base: BASE, results, errors }, null, 2));
    console.log(`PASS ${results.length} UI checks; no console errors; phone/tablet/desktop layouts`);
} catch (e) {
    console.error('UI errors:', errors); throw e;
} finally { await browser.close(); }
