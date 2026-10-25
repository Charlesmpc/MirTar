import type { EventEmitter } from 'node:events';

/** Agent-neutral message connection. Both WebSocket and BLE implement this. */
export interface DevicePeer extends EventEmitter {
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(text: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  ping(): void;
}
