import { randomBytes } from 'node:crypto';
import type { DevicePeer } from './transport/peer.ts';
import type { BridgeConfig } from './contracts.ts';

/** Only attach to the native authenticated/encrypted BLE onboarding transport, never WebSocket. */
export function enrollServer(peer: DevicePeer, config: BridgeConfig, persist: (next: BridgeConfig) => Promise<void>, timeoutMs=120000) {
  return new Promise<void>((resolve,reject) => {
    let busy=false,offered=false,done=false,nonce='',deviceId='';
    const finish=(error?: Error) => {
      if(done)return;done=true;clearTimeout(timer);peer.off('message',receive);peer.off('close',closed);
      if(error){peer.close();reject(error);}else resolve();
    };
    const timer=setTimeout(()=>finish(Error('pairing_timeout')),timeoutMs);
    const closed=()=>finish(Error('pairing_disconnected_configuration_retained'));
    const receive=async (data: Buffer,binary: boolean) => {
      if(done)return;
      try {
        if(binary||data.length>2048)throw Error('invalid_pairing_message');
        const msg=JSON.parse(data.toString('utf8'));
        if(msg.type==='pair_saved') {
          if(!offered||msg.nonce!==nonce||msg.serverId!==config.server?.id)throw Error('invalid_pairing_receipt');
          finish();return;
        }
        if(msg.type!=='pair_hello'||busy||offered)throw Error('unexpected_pairing_message');
        if(!/^[a-zA-Z0-9_-]{1,40}$/.test(msg.deviceId)||!/^[a-f0-9]{32}$/.test(msg.nonce))throw Error('invalid_card_identity');
        if(!config.server||!/^[a-zA-Z0-9_-]{1,40}$/.test(config.server.id)||!config.server.name||Buffer.byteLength(config.server.name)>40||/[\x00-\x1f\x7f]/.test(config.server.name)||!config.bluetooth?.hostName)throw Error('invalid_server_identity');
        busy=true;nonce=msg.nonce;deviceId=msg.deviceId;
        const known=config.devices.find(d=>d.id===deviceId);
        const device=known||{id:deviceId,secret:randomBytes(32).toString('hex')};
        if(!known&&config.devices.length>=16)throw Error('computer_device_limit');
        if(!/^[a-zA-Z0-9_-]{1,20}$/.test(config.bluetooth.hostName)||device.secret.length<32||device.secret.length>128||/^(REPLACE_WITH_|FILL_LOCALLY|SAME_LOCAL_)/.test(device.secret))throw Error('invalid_binding_configuration');
        const next={...config,devices:known?config.devices:[...config.devices,device]};
        // Persist before sending: cancellation may leave an unused entry, but cannot lose the only key after card save.
        await persist(next);if(done)return;
        offered=true;
        peer.send(JSON.stringify({type:'pair_offer',deviceId,nonce,server:{id:config.server.id,name:config.server.name,bluetoothName:config.bluetooth.hostName,secret:device.secret}}));
      } catch { finish(Error('pairing_failed_check_local_configuration')); }
    };
    peer.on('message',receive);peer.on('close',closed);
  });
}
