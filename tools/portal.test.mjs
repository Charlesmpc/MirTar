import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const html=readFileSync(new URL('../firmware/main/portal.html',import.meta.url),'utf8');
function setup(phase='ready',rejectPost=false){
  const elements=Object.fromEntries(['setup','save','status','config','device-id'].map(id=>[id,{textContent:'',disabled:false,files:[],events:{},addEventListener(type,fn){this.events[type]=fn;}}]));
  const requests=[],timers=[];
  runInNewContext(html.match(/<script>([\s\S]+)<\/script>/)[1],{document:{getElementById:id=>elements[id]},TextEncoder,setTimeout:fn=>timers.push(fn),fetch:async(url,options)=>{
    requests.push({url,options});return {ok:!(rejectPost&&url==='/api/config'),status:400,json:async()=>({csrf:'local-proof',phase,deviceId:'test-card',servers:1})};
  }});
  return {elements,requests,timers,settle:()=>new Promise(r=>setImmediate(r))};
}
const config={version:2,deviceId:'test-card',servers:[{id:'host-1',name:'Work laptop',bluetoothName:'WorkLaptop',secret:'a'.repeat(64)}]};
async function send(env,text){env.elements.config.files=[{size:Buffer.byteLength(text),text:async()=>text}];await env.elements.setup.events.submit({preventDefault(){}});}
test('upload page has file-only controls and shows card identity without returning keys',async()=>{
  const e=setup();await e.settle();assert.equal(e.elements['device-id'].textContent,'test-card');assert.equal(e.elements.save.disabled,false);
  assert(!html.includes('name="ssid"'));assert(!html.includes('type="password"'));
});
test('file import posts the actual v2 config with CSRF and accepts a Windows UTF8 BOM',async()=>{
  const e=setup();await e.settle();await send(e,'\uFEFF'+JSON.stringify(config));const req=e.requests.find(r=>r.url==='/api/config');
  assert.equal(req.options.headers['X-MirTar-Setup'],'local-proof');assert.deepEqual(JSON.parse(req.options.body),config);
});
test('legacy, template, oversized and empty imports are stopped before transmission',async()=>{
  for(const text of [JSON.stringify({...config,version:1}),JSON.stringify({...config,template:true}),JSON.stringify({...config,servers:[]}), '{"secret":"private-test-only",}', 'x'.repeat(4097)]){
    const e=setup();await e.settle();await send(e,text);assert.equal(e.requests.filter(r=>r.url==='/api/config').length,0);assert.equal(e.elements.save.disabled,false);
    assert(!e.elements.status.textContent.includes('private-test-only'));
  }
});
test('save failures allow retry while a saved response ends polling',async()=>{
  const failed=setup('ready',true);await failed.settle();await send(failed,JSON.stringify(config));assert.equal(failed.elements.save.disabled,false);
  const saved=setup('saved');await saved.settle();assert.equal(saved.elements.save.disabled,true);assert.equal(saved.timers.length,0);assert.match(saved.elements.status.textContent,/配置已保存/);
});
