import type {Env} from './index';
import {assert} from './wire';
export function lobbyRPC(env:Env,op:string,value:any) {return env.LOBBY.get(env.LOBBY.idFromName('lobby')).fetch(new Request(`https://internal/${op}`,{method:'POST',body:JSON.stringify(value)})).then(r=>r.json<any>());}
export async function identity(env:Env,uid:string,touch=false) {
  const result=await env.ACCOUNTS.get(env.ACCOUNTS.idFromName('accounts')).fetch(new Request('https://internal/identity',{method:'POST',body:JSON.stringify({id:uid,touch})})).then(r=>r.json<any>());
  assert(result.ok,'unauthenticated');return result as {ok:boolean;name:string};
}
