import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { Client, until } from './ws-client.mjs';
const bundle = await build({ entryPoints: ['scripts/lifecycle-harness.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] });
const mf = new Miniflare(convertV4MiniflareOptions({ name: 'lifecycle-test', modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-11-04',
    bindings: { PUBLIC_ORIGIN: '' }, durableObjects: { ROOMS: { className: 'Room', useSQLite: true }, ACCOUNTS: { className: 'Accounts', useSQLite: true } },
    durableObjectsPersist: false, unsafeInspectDurableObjects: true,
}));
const base = (await mf.ready).origin;
const clients = [];
const open = async (game, room, identity) => { const c = await Client.open(game, room, base, base, { identity }); clients.push(c); return c; };
const name = 'rooms/lifecycle', root = name;
const seed = uid => ({ status: 'waiting', currentIndex: 0, startChar: 'あ', endChar: 'ん', playersOrder: [uid], players: { [uid]: { name: 'Alice', isHost: true } }, gameData: [], canvasData: '' });
try {
    const account = await open(); const identity = await account.auth();
    const a = await open('rooms', 'lifecycle', identity); await a.auth(identity);
    await a.request('set', { path: root, value: seed(identity.uid) });
    await a.request('subscribe', { path: root, sub: 'state' });
    const bindings = await mf.getBindings(); const stub = bindings.ROOMS.get(bindings.ROOMS.idFromName(name));
    const fresh = await stub.fetch('https://internal/test-alarm').then(r => r.json());
    assert(fresh.alive && fresh.next > Date.now() + 23 * 3600000);
    await mf.unsafeEvictDurableObject('lifecycle-test', 'Room', { name, webSockets: 'hibernate' });
    assert.equal((await a.request('get', { path: root })).players[identity.uid].name, 'Alice');
    await a.request('update', { path: root, value: { startChar: 'か' } });
    await until(() => a.events.some(m => m.value?.startChar === 'か'), 'hibernated subscription');
    console.log('PASS lifecycle: SQLite state, authentication and subscriptions survive DO hibernation; fresh alarm reschedules');
    const expired = await stub.fetch('https://internal/test-expire').then(r => r.json()); assert.equal(expired.cleared, true);
    await until(() => a.socket.readyState !== 1, 'expiry closes room socket');
    const replacement = await open('rooms', 'lifecycle', identity); await replacement.auth(identity);
    assert.equal(await replacement.request('get', { path: root }), null);
    await replacement.request('set', { path: root, value: seed(identity.uid) });
    assert.equal((await replacement.request('get', { path: root })).status, 'waiting');
    console.log('PASS lifecycle: aged room deleted by actual alarm(), sockets closed, same code can create a fresh room');
    // Hard connection bounds, independently of browser controls.
    for (let i = 0; i < 7; i++) { const c = await open(); await c.auth(identity); }
    const ninth = await open(); await assert.rejects(ninth.auth(identity), /connections_full/);
    for (const c of clients) if (c !== replacement) c.close();
    await new Promise(r => setTimeout(r, 50));
    const full = [];
    let member;
    for (let i = 0; i < 32; i++) {
        if (i % 8 === 0) { const account = await open(); member = await account.auth(); account.close(); }
        full.push(await open('rooms', 'connection-bound', member));
    }
    const extra = await open(); const extraId = await extra.auth();
    await assert.rejects(open('rooms', 'connection-bound', extraId), /429/);
    full.forEach(c => c.close());
    console.log('PASS limits: 8 connections/user and 32 connections/room enforced');
    const image = 'data:image/png;base64,' + 'A'.repeat(512 * 1024 - 40);
    let rejected = false;
    for (let i = 0; i < 18; i++) {
        await new Promise(resolve => setTimeout(resolve, 180));
        try { await replacement.request('update', { path: root, value: { [`gameData/${i}`]: { player: 'Alice', image, answer: 'あ' } } }); }
        catch (e) { assert.match(e.message, /room_too_large/); rejected = true; break; }
    }
    assert(rejected, '8 MiB room capacity must be enforced');
    assert(Buffer.byteLength(JSON.stringify(await replacement.request('get', { path: root }))) <= 8 * 1024 * 1024);
    console.log('PASS limits: cumulative room capacity rejected atomically before exceeding 8 MiB');
} finally { clients.forEach(c => c.close()); await mf.dispose(); }
