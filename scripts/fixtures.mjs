import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {Client,BASE} from './ws-client.mjs';
// Reuse test devices so repeated local/public runs respect the production IP account cap.
export async function accountFixture(label){
  await mkdir('.wrangler/test-results',{recursive:true});
  const file=`.wrangler/test-results/device-${new URL(BASE).host.replace(/[^a-z0-9]/gi,'_')}-${label}.json`;
  let saved;try{saved=JSON.parse(await readFile(file,'utf8'));}catch{try{saved=JSON.parse(await readFile(file.replace('.wrangler/',''),'utf8'));}catch{}}
  const client=await Client.open();let identity;
  try{identity=await client.auth(saved);}catch(e){if(e.message!=='invalid_credentials'){client.close();throw e;}identity=await client.auth();}
  if(!saved||identity.uid!==saved.uid)await writeFile(file,JSON.stringify(identity));return {client,identity};
}
