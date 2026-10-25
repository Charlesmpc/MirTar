using System;
using System.Collections.Generic;

// A restored CCCD may deliver hello before the subscribe operation completes.
// Keep it in order, but do not start the application's authentication timer yet.
public sealed class BleNotificationGate {
    readonly object sync = new object();
    readonly Queue<byte[]> pending = new Queue<byte[]>();
    readonly Action connected;
    readonly Action<byte[]> packet;
    int bytes;
    bool opened, closed;
    public BleNotificationGate(Action connected, Action<byte[]> packet) {
        this.connected = connected; this.packet = packet;
    }
    public void Receive(byte[] value) {
        lock (sync) {
            if (closed) return;
            if (opened) { packet(value); return; }
            if (pending.Count >= 64 || bytes + value.Length > 8192) throw new InvalidOperationException("notification_buffer_limit");
            pending.Enqueue(value); bytes += value.Length;
        }
    }
    public void Open() {
        lock (sync) {
            if (closed || opened) return;
            opened = true; connected();
            while (!closed && pending.Count != 0) packet(pending.Dequeue());
            bytes = 0;
        }
    }
    public void Close() {
        lock (sync) { closed = true; pending.Clear(); bytes = 0; }
    }
}
