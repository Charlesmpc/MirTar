import test from 'node:test';
import assert from 'node:assert/strict';
import { BleAssembler, fragmentBle } from '../src/transport/ble-framing.ts';

test('BLE reconstructs UTF-8 reply and PCM at default and negotiated ATT sizes', () => {
  for (const size of [20, 97, 244]) {
    const rx = new BleAssembler(); let id = 254;
    for (const data of [Buffer.from('你好'.repeat(900)), Buffer.alloc(652, 123), Buffer.from('next')]) {
      const packets = fragmentBle(data, id === 255, id, size); let result;
      for (const packet of packets) result = rx.append(packet);
      assert.deepEqual(result?.data, data); assert.equal(result?.binary, id === 255); id = (id + 1) & 255;
    }
  }
});
test('BLE refuses fragment loss, duplicate messages, interleaving and oversize allocation', () => {
  const packets = fragmentBle(Buffer.alloc(100), true, 0, 20);
  let rx = new BleAssembler(); rx.append(packets[0]); assert.throws(() => rx.append(packets[2]), /sequence/);
  rx = new BleAssembler(); for (const packet of packets) rx.append(packet);
  assert.throws(() => rx.append(packets[0]), /sequence/);
  rx = new BleAssembler(); rx.append(packets[0]); assert.throws(() => rx.append(fragmentBle(Buffer.from('x'), false, 1, 20)[0]), /sequence/);
  const bad = Buffer.from(packets[0]); bad.writeUInt16LE(65535, 4);
  assert.throws(() => new BleAssembler().append(bad), /size/);
  assert.throws(() => fragmentBle(Buffer.alloc(8193), false, 1, 244), /size/);
});
