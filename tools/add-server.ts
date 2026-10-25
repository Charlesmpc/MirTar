import { readFile,writeFile,rename,copyFile,unlink } from 'node:fs/promises';
import { resolve,sep } from 'node:path';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { BridgeConfig } from '../bridge/src/contracts.ts';
import { startWindowsBle } from '../bridge/src/transport/windows-ble.ts';
import { enrollServer } from '../bridge/src/onboarding.ts';

const path=resolve(process.argv[2]||'.private/bridge.config.json');
if(!path.toLowerCase().startsWith((resolve('.private')+sep).toLowerCase()))throw Error('Binding credentials must stay in the ignored .private folder.');
let snapshot=await readFile(path,'utf8');
let config: BridgeConfig;
try{config=JSON.parse(snapshot.replace(/^\uFEFF/,'')) as BridgeConfig;}catch{throw Error('Private bridge configuration is not valid JSON; values suppressed.');}
if(config.version!==1||!Array.isArray(config.devices)||!config.bluetooth?.hostName)throw Error('Generate a private bridge configuration first.');
config.server={id:config.server?.id||config.bluetooth.hostName,name:process.argv[3]||config.server?.name||hostname()};
if(!config.server.name||Buffer.byteLength(config.server.name)>40||/[\x00-\x1f\x7f]/.test(config.server.name))throw Error('Use a server display name of 1–40 UTF-8 bytes.');
const persist=async (next: BridgeConfig) => {
  if(await readFile(path,'utf8')!==snapshot)throw Error('configuration_changed');
  const temp=path+'.'+randomUUID()+'.tmp';
  try {
    await copyFile(path,path+'.'+randomUUID()+'.backup');
    const text=JSON.stringify(next,null,2)+'\n';
    await writeFile(temp,text,{flag:'wx',mode:0o600});
    await rename(temp,path);snapshot=text;
  } finally { await unlink(temp).catch(()=>{}); }
};
// Persist the stable host identity once. Subsequent renaming keeps the same ID.
await persist(config);
console.log('On the card choose Add server. Complete the Windows PIN prompt, then press OK on the card to confirm:',config.server.name);
let active=false,finished=false;
let finish!:()=>void;
const stopped=new Promise<void>(r=>{finish=r;});
const worker=startWindowsBle(config.bluetooth.hostName,peer=>{
  if(active){peer.close();return;}active=true;
  enrollServer(peer,config,persist).then(()=>{console.log('Server saved on card. Restart the normal bridge, then choose Server list.');finished=true;finish();})
    .catch(()=>{console.error('Adding server failed or was cancelled. Saved binding keys are retained; retry the same command.');process.exitCode=1;finish();});
},true);
const timeout=setTimeout(()=>{process.exitCode=1;console.error('Adding server timed out.');finish();},150000);
const stop=()=>{if(!finished)process.exitCode=1;finish();};
process.once('SIGINT',stop);process.once('SIGTERM',stop);
await stopped;clearTimeout(timeout);await worker.close();
