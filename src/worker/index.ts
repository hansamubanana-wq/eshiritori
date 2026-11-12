export { Room } from './room';
export { Accounts } from './accounts';
import { GAME_TYPES, roomCode } from './schema';

export interface Env {
  ROOMS: DurableObjectNamespace;
  ACCOUNTS: DurableObjectNamespace;
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
    const game = url.searchParams.get('game');
    const code = url.searchParams.get('room');
    if (!game && !code) return env.ACCOUNTS.get(env.ACCOUNTS.idFromName('accounts')).fetch(req);
    if (!game || !GAME_TYPES.includes(game) || !roomCode(code)) return new Response('Invalid room', { status: 400 });
    return env.ROOMS.get(env.ROOMS.idFromName(`${game}/${code}`)).fetch(req);
  },
} satisfies ExportedHandler<Env>;
