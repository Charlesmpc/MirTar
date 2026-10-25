using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;

public static class BleNotificationGateTest {
    static void Check(bool condition, string name) { if (!condition) throw new Exception(name); }
    public static int Main(string[] args) {
        try {
            var events = new List<int>();
            var gate = new BleNotificationGate(() => events.Add(0), bytes => events.Add(bytes[0]));
            gate.Receive(new byte[] { 1 });
            // Reproduce a subscription slower than the bridge's 5-second auth timeout.
            // No application peer/timer may exist while it is still pending.
            Thread.Sleep(5200);
            Check(events.Count == 0, "premature peer before CCCD success");
            gate.Receive(new byte[] { 2 }); gate.Open(); gate.Open(); gate.Receive(new byte[] { 3 });
            Check(String.Join(",", events) == "0,1,2,3", "connected must precede ordered, once-only hello packets");
            gate.Close(); gate.Receive(new byte[] { 4 }); gate.Open();
            Check(events.Count == 4, "stale notifications after close");
            var failed = new BleNotificationGate(() => { throw new Exception("failed subscription activated"); }, bytes => { throw new Exception("failed subscription delivered"); });
            failed.Receive(new byte[] { 1 }); failed.Close(); failed.Open();
            var bounded = new BleNotificationGate(() => { }, bytes => { });
            bounded.Receive(new byte[8192]);
            bool rejected = false;
            try { bounded.Receive(new byte[] { 1 }); } catch (InvalidOperationException) { rejected = true; }
            Check(rejected, "unbounded pending notification bytes"); bounded.Close();
            var countBound = new BleNotificationGate(() => { }, bytes => { });
            for (int n = 0; n < 64; n++) countBound.Receive(new byte[1]);
            rejected = false;
            try { countBound.Receive(new byte[1]); } catch (InvalidOperationException) { rejected = true; }
            Check(rejected, "unbounded pending notification count"); countBound.Close();
            // Callback and close may race. Each old gate remains permanently closed.
            for (int n = 0; n < 100; n++) {
                int connected = 0;
                var racing = new BleNotificationGate(() => connected++, bytes => { });
                var producer = new Thread(() => { for (int k = 0; k < 100; k++) racing.Receive(new byte[1]); });
                racing.Open(); producer.Start(); racing.Close(); producer.Join(); racing.Open();
                Check(connected == 1, "closed gate reopened during callback race");
            }
            File.WriteAllText(args[0], "PASS: slow CCCD, buffered hello, failed subscribe, bounds and close races\n");
            return 0;
        } catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
    }
}
