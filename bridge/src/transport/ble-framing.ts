// One ordered GATT notification/write stream. Header: kind, message ID,
// offset uint16 LE, total uint16 LE. Link encryption is mandatory independently.
export const BLE_SERVICE = '9a9d0001-4dc1-4c62-8c18-3578e35c7ab1';
export const BLE_RX = '9a9d0002-4dc1-4c62-8c18-3578e35c7ab1';
export const BLE_TX = '9a9d0003-4dc1-4c62-8c18-3578e35c7ab1';
export function fragmentBle(data: Buffer, binary: boolean, id: number, valueSize: number): Buffer[] {
  if (!data.length || data.length > 8192 || valueSize < 20 || valueSize > 512) throw Error('ble_size');
  const packets: Buffer[] = [];
  for (let offset = 0; offset < data.length; offset += valueSize - 6) {
    const body = data.subarray(offset, offset + valueSize - 6), packet = Buffer.alloc(6 + body.length);
    packet[0] = binary ? 1 : 0; packet[1] = id & 255;
    packet.writeUInt16LE(offset, 2); packet.writeUInt16LE(data.length, 4); body.copy(packet, 6); packets.push(packet);
  }
  return packets;
}
export class BleAssembler {
  private data = Buffer.alloc(0);
  private used = 0;
  private id = -1;
  private kind = -1;
  private expected = -1;
  private deadline = 0;
  reset() { this.data = Buffer.alloc(0); this.used = 0; this.id = this.expected = -1; }
  append(packet: Buffer): { data: Buffer; binary: boolean } | undefined {
    if (packet.length < 7 || packet[0] > 1) throw Error('ble_header');
    const kind = packet[0], id = packet[1], offset = packet.readUInt16LE(2), size = packet.readUInt16LE(4);
    if (!size || size > 8192 || packet.length - 6 + offset > size) throw Error('ble_size');
    if (offset === 0) {
      if (this.used || this.expected >= 0 && id !== this.expected) throw Error('ble_sequence');
      this.data = Buffer.alloc(size); this.id = id; this.kind = kind; this.deadline = Date.now() + 5000;
    }
    if (Date.now() > this.deadline || this.id !== id || this.kind !== kind || offset !== this.used || this.data.length !== size) throw Error('ble_sequence');
    packet.copy(this.data, offset, 6); this.used += packet.length - 6;
    if (this.used < size) return;
    const result = { data: this.data, binary: kind === 1 };
    this.expected = (id + 1) & 255; this.data = Buffer.alloc(0); this.used = 0;
    return result;
  }
}
