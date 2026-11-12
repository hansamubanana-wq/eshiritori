export { Room } from './room';
export { Accounts } from './accounts';
export { Lobby } from './lobby';
export { Table } from './table';
import { GAME_TYPES, roomCode } from './schema';
import { fixedTable } from '../../catalog.js';

export interface Env {
  ROOMS: DurableObjectNamespace;
  ACCOUNTS: DurableObjectNamespace;
  LOBBY: DurableObjectNamespace;
  TABLES: DurableObjectNamespace;
  ASSETS: Fetcher;
  PUBLIC_ORIGIN: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname !== '/ws') return env.ASSETS.fetch(req);
    const origin = req.headers.get('Origin');
    let local = false;
    try {
      const o = new URL(origin || '');
      local = ['localhost', '127.0.0.1', '[::1]'].includes(o.hostname) &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && ['http:', 'https:'].includes(o.protocol);
    } catch {}
    if (!origin || (!local && origin !== env.PUBLIC_ORIGIN)) return new Response('Forbidden origin', { status: 403 });
    if (req.method !== 'GET' || req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', { status: 426 });
    const isLobby = url.searchParams.get('lobby') === '1';
    const game = isLobby ? 'lobby' : url.searchParams.get('game');
    const code = isLobby ? 'main' : url.searchParams.get('room');
    if (!game && !code) return env.ACCOUNTS.get(env.ACCOUNTS.idFromName('accounts')).fetch(req);
    if (!isLobby && (!game || !fixedTable(game, code))) return new Response('Invalid table', { status: 400 });
    const admission = await env.ACCOUNTS.get(env.ACCOUNTS.idFromName('accounts')).fetch(new Request('https://internal/admit-room', {
      method: 'POST', body: JSON.stringify({ game, code, ticket: url.searchParams.get('ticket'), ip: req.headers.get('CF-Connecting-IP') || 'local' }),
    }));
    if (!admission.ok) return new Response(await admission.text(), { status: admission.status });
    const identity = await admission.json<{ uid: string }>();
    const headers = new Headers(req.headers); headers.set('X-Authenticated-Uid', identity.uid);
    url.searchParams.delete('ticket');
    return isLobby ? env.LOBBY.get(env.LOBBY.idFromName('lobby')).fetch(new Request(url, { headers })) : env.TABLES.get(env.TABLES.idFromName(`${game}/${code}`)).fetch(new Request(url, { headers }));
  },
} satisfies ExportedHandler<Env>;
