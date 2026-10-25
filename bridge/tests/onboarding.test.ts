import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { enrollServer } from '../src/onboarding.ts';
import type { BridgeConfig } from '../src/contracts.ts';
class Peer extends EventEmitter {
  readyState=1;bufferedAmount=0;messages:any[]=[];
  send(text:string){this.messages.push(JSON.parse(text));}
  close(){this.readyState=3;this.emit('close');}terminate(){this.close();}ping(){}
  control(value:unknown){this.emit('message',Buffer.from(JSON.stringify(value)),false);}
}
const config=():BridgeConfig=>({version:1,listen:{host:'127.0.0.1',port:0,allowLanPlaintext:true},bluetooth:{enabled:true,hostName:'WorkLaptop'},server:{id:'host-1',name:'Work laptop'},devices:[],codex:{bin:'',edgePath:'',sessions:[]}});
const hello={type:'pair_hello',deviceId:'card-1',nonce:'a'.repeat(32)};
test('onboarding persists binding before offering it; card receipt must confirm the stable ID and nonce',async()=>{
  const peer=new Peer();let persisted:BridgeConfig|undefined,release!:()=>void;
  const wait=new Promise<void>(r=>{release=r;});const c=config();
  const done=enrollServer(peer,c,async next=>{await wait;persisted=next;});
  peer.control(hello);await delay(1);assert.equal(peer.messages.length,0);release();await delay(5);
  assert.equal(peer.messages.length,1);const offer=peer.messages[0];assert.equal(offer.type,'pair_offer');
  assert.equal(offer.server.secret,persisted!.devices[0].secret);assert.equal(offer.server.secret.length,64);assert.equal(offer.server.wifi,undefined);
  let completed=false;done.then(()=>{completed=true;});await delay(1);assert.equal(completed,false);
  peer.control({type:'pair_saved',nonce:hello.nonce,serverId:'host-1'});await done;assert.equal(completed,true);
});
test('failed local persistence never transmits a binding key',async()=>{
  const peer=new Peer(),done=enrollServer(peer,config(),async()=>{throw Error('disk failure');});const rejected=assert.rejects(done,/pairing_failed/);
  peer.control(hello);await rejected;assert.equal(peer.messages.length,0);
});
test('onboarding rejects a stale receipt and reuses a previously persisted device key',async()=>{
  const peer=new Peer(),c=config();c.devices=[{id:'card-1',secret:'b'.repeat(64)}];
  const done=enrollServer(peer,c,async()=>{}),rejected=assert.rejects(done,/pairing_failed/);
  peer.control(hello);await delay(5);assert.equal(peer.messages[0].server.secret,c.devices[0].secret);
  peer.control({type:'pair_saved',nonce:'c'.repeat(32),serverId:'host-1'});await rejected;
});
test('onboarding times out without granting Agent access',async()=>{
  const peer=new Peer();await assert.rejects(enrollServer(peer,config(),async()=>{},10),/pairing_timeout/);assert.equal(peer.readyState,3);assert.equal(peer.messages.length,0);
});
test('oversized and binary input cannot enroll a card',async()=>{
  for(const [data,binary] of [[Buffer.alloc(2049),false],[Buffer.from('{}'),true]] as const){
    const peer=new Peer();let saves=0;const done=enrollServer(peer,config(),async()=>{saves++;}),rejected=assert.rejects(done,/pairing_failed/);
    peer.emit('message',data,binary);await rejected;assert.equal(saves,0);
  }
});
