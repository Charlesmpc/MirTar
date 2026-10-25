// Built with the Windows .NET Framework compiler; no .NET SDK or NuGet required.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Windows.Devices.Bluetooth;
using Windows.Devices.Bluetooth.Advertisement;
using Windows.Devices.Bluetooth.GenericAttributeProfile;
using Windows.Devices.Enumeration;
using Windows.Storage.Streams;

public static class BluetoothWorker {
    static readonly Guid Service = new Guid("9a9d0001-4dc1-4c62-8c18-3578e35c7ab1");
    static readonly Guid Rx = new Guid("9a9d0002-4dc1-4c62-8c18-3578e35c7ab1");
    static readonly Guid Tx = new Guid("9a9d0003-4dc1-4c62-8c18-3578e35c7ab1");
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static readonly object OutputLock = new object();
    static readonly SemaphoreSlim Writes = new SemaphoreSlim(1);
    static readonly object StateLock = new object();
    sealed class Connection {
        public readonly int Id;
        public readonly BleNotificationGate Gate;
        public BluetoothLEDevice Device;
        public GattDeviceService Service;
        public GattSession Session;
        public GattCharacteristic Receive, Transmit;
        public Connection(int id) {
            Id = id;
            Gate = new BleNotificationGate(
                () => Emit(new { type = "connected", connectionId = Id, valueSize = Math.Min(244, (int)Session.MaxPduSize - 3) }),
                bytes => Emit(new { type = "packet", connectionId = Id, data = Convert.ToBase64String(bytes) }));
        }
        public void ValueChanged(GattCharacteristic sender, GattValueChangedEventArgs args) {
            try {
                using (var reader = DataReader.FromBuffer(args.CharacteristicValue)) {
                    var bytes = new byte[reader.UnconsumedBufferLength]; reader.ReadBytes(bytes); Gate.Receive(bytes);
                }
            } catch { Status("notification_failed"); Release(this); }
        }
        public void ConnectionChanged(BluetoothLEDevice sender, object args) {
            if (sender.ConnectionStatus == BluetoothConnectionStatus.Disconnected) Release(this);
        }
        public void MtuChanged(GattSession sender, object args) {
            if (IsCurrent(this)) Emit(new { type = "mtu", connectionId = Id, valueSize = Math.Min(244, (int)sender.MaxPduSize - 3) });
        }
        public void Dispose() {
            Gate.Close();
            // Cleanup can race an OS disconnect or a cancelled discovery operation.
            // A final cleanup after Connect completes also releases late results.
            var tx = Transmit; Transmit = Receive = null;
            var d = Device; Device = null;
            var s = Session; Session = null;
            var svc = Service; Service = null;
            try { if (tx != null) tx.ValueChanged -= ValueChanged; } catch { }
            try { if (d != null) d.ConnectionStatusChanged -= ConnectionChanged; } catch { }
            try { if (s != null) { s.MaxPduSizeChanged -= MtuChanged; s.MaintainConnection = false; s.Dispose(); } } catch { }
            try { if (svc != null) svc.Dispose(); } catch { }
            try { if (d != null) d.Dispose(); } catch { }
        }
    }
    static Connection connection;
    static string expectedName;
    static int connecting, nextConnection;
    static volatile bool stopping, refreshCache;
    static void Emit(object message) { lock (OutputLock) { Console.WriteLine(Json.Serialize(message)); Console.Out.Flush(); } }
    static void Status(string code) { Emit(new { type = "status", code = code }); }
    static async Task<T> Await<T>(Windows.Foundation.IAsyncOperation<T> operation) {
        try {
            var deadline = DateTime.UtcNow.AddSeconds(90);
            while (operation.Status == Windows.Foundation.AsyncStatus.Started) {
                if (DateTime.UtcNow > deadline) { operation.Cancel(); throw new TimeoutException(); }
                await Task.Delay(15);
            }
            return operation.GetResults();
        } finally { operation.Close(); }
    }
    static string AskPin() {
        string answer = null;
        var thread = new Thread(() => {
            using (var form = new Form()) using (var timer = new System.Windows.Forms.Timer()) {
                form.Text = "MirTar Bluetooth pairing"; form.Width = 400; form.Height = 185;
                form.StartPosition = FormStartPosition.CenterScreen; form.TopMost = true;
                var label = new Label { Text = "Enter the 6-digit code shown on your badge:", Left = 18, Top = 18, Width = 355 };
                var input = new TextBox { Left = 18, Top = 49, Width = 345, MaxLength = 6 };
                var ok = new Button { Text = "Pair", Left = 195, Top = 85, DialogResult = DialogResult.OK };
                var cancel = new Button { Text = "Cancel", Left = 280, Top = 85, DialogResult = DialogResult.Cancel };
                form.Controls.AddRange(new Control[] { label, input, ok, cancel }); form.AcceptButton = ok; form.CancelButton = cancel;
                timer.Interval = 60000; timer.Tick += (s, e) => form.Close(); timer.Start();
                if (form.ShowDialog() == DialogResult.OK && input.Text.Length == 6 && input.Text.All(Char.IsDigit)) answer = input.Text;
            }
        });
        thread.SetApartmentState(ApartmentState.STA); thread.Start(); thread.Join(); return answer;
    }
    static void PairingRequested(DeviceInformationCustomPairing sender, DevicePairingRequestedEventArgs args) {
        var deferral = args.GetDeferral();
        try { if (args.PairingKind == DevicePairingKinds.ProvidePin) { var pin = AskPin(); if (pin != null) args.Accept(pin); } }
        finally { deferral.Complete(); }
    }
    static bool IsCurrent(Connection value) { lock (StateLock) return connection == value && !stopping; }
    static void CheckCurrent(Connection value) { if (!IsCurrent(value)) throw new OperationCanceledException(); }
    static void Release(Connection expected = null) {
        Connection old;
        lock (StateLock) {
            old = connection;
            if (old == null || expected != null && old != expected) return;
            old.Gate.Close(); connection = null;
            Emit(new { type = "disconnected", connectionId = old.Id });
        }
        old.Dispose();
    }
    static async Task Connect(ulong address) {
        if (stopping || Interlocked.CompareExchange(ref connecting, 1, 0) != 0) return;
        var c = new Connection(Interlocked.Increment(ref nextConnection));
        lock (StateLock) {
            if (connection != null || stopping) { Interlocked.Exchange(ref connecting, 0); return; }
            connection = c;
        }
        bool complete = false;
        string stage = "open_device";
        try {
            c.Device = await Await(BluetoothLEDevice.FromBluetoothAddressAsync(address)); CheckCurrent(c);
            if (c.Device == null) throw new Exception();
            if (!c.Device.DeviceInformation.Pairing.IsPaired) {
                stage = "pair_device";
                Status("pairing_required");
                var custom = c.Device.DeviceInformation.Pairing.Custom;
                custom.PairingRequested += PairingRequested;
                try {
                    var paired = await Await(custom.PairAsync(DevicePairingKinds.ProvidePin, DevicePairingProtectionLevel.EncryptionAndAuthentication));
                    CheckCurrent(c);
                    Status("pair_result_" + paired.Status.ToString().ToLowerInvariant());
                    if (paired.Status != DevicePairingResultStatus.Paired && paired.Status != DevicePairingResultStatus.AlreadyPaired) {
                        Status("pairing_failed"); return;
                    }
                } finally { custom.PairingRequested -= PairingRequested; }
            }
            Status("paired");
            stage = "create_session";
            c.Session = await Await(GattSession.FromDeviceIdAsync(c.Device.BluetoothDeviceId)); CheckCurrent(c);
            if (c.Session == null) throw new Exception();
            c.Session.MaxPduSizeChanged += c.MtuChanged;
            // Keep the cached path so the notification handler is installed before
            // a bonded CCCD restores hello. After a failure, refresh the OS cache
            // on a separate connection, then reconnect with handlers in place.
            bool refreshing = refreshCache;
            var mode = refreshing ? BluetoothCacheMode.Uncached : BluetoothCacheMode.Cached;
            if (refreshing) { Status("refreshing_gatt_cache"); c.Session.MaintainConnection = true; }
            stage = "discover_service";
            var discovery = c.Device.GetGattServicesAsync(mode);
            stage = "await_service";
            var services = await Await(discovery);
            if (!IsCurrent(c)) { foreach (var found in services.Services) found.Dispose(); CheckCurrent(c); }
            stage = "read_services";
            Status("service_" + services.Status.ToString().ToLowerInvariant() + "_count_" + services.Services.Count);
            if (services.Status != GattCommunicationStatus.Success) {
                foreach (var found in services.Services) found.Dispose();
                throw new Exception();
            }
            foreach (var found in services.Services) {
                if (found.Uuid == Service && c.Service == null) c.Service = found;
                else found.Dispose();
            }
            if (c.Service == null) throw new Exception();
            stage = "discover_characteristics";
            var characteristics = await Await(c.Service.GetCharacteristicsAsync(mode)); CheckCurrent(c);
            Status("characteristics_" + characteristics.Status.ToString().ToLowerInvariant() + "_count_" + characteristics.Characteristics.Count);
            if (characteristics.Status != GattCommunicationStatus.Success) throw new Exception();
            c.Receive = characteristics.Characteristics.SingleOrDefault(ch => ch.Uuid == Rx);
            c.Transmit = characteristics.Characteristics.SingleOrDefault(ch => ch.Uuid == Tx);
            if (c.Receive == null || c.Transmit == null) throw new Exception();
            if (refreshing) { refreshCache = false; Status("gatt_cache_refreshed_reconnecting"); return; }
            stage = "set_protection";
            c.Receive.ProtectionLevel = GattProtectionLevel.EncryptionAndAuthenticationRequired;
            c.Transmit.ProtectionLevel = GattProtectionLevel.EncryptionAndAuthenticationRequired;
            // Bonded CCCDs can restore automatically on reconnect. Register the
            // handler before maintaining the link so the first hello is observed.
            c.Transmit.ValueChanged += c.ValueChanged;
            c.Session.MaintainConnection = true;
            stage = "subscribe_notifications";
            for (int attempt = 1; ; attempt++) {
                Status("subscribe_attempt_" + attempt);
                var elapsed = System.Diagnostics.Stopwatch.StartNew();
                var result = await Await(c.Transmit.WriteClientCharacteristicConfigurationDescriptorWithResultAsync(GattClientCharacteristicConfigurationDescriptorValue.Notify));
                CheckCurrent(c);
                Status("subscribe_" + result.Status.ToString().ToLowerInvariant());
                Status("subscribe_elapsed_ms_" + elapsed.ElapsedMilliseconds);
                if (result.ProtocolError.HasValue) Status("subscribe_att_error_" + result.ProtocolError.Value.ToString("x2"));
                if (result.Status == GattCommunicationStatus.Success) break;
                if (result.Status != GattCommunicationStatus.Unreachable || attempt >= 3) throw new Exception();
                Status("subscribe_retry_" + attempt); await Task.Delay(attempt * 500); CheckCurrent(c);
            }
            c.Device.ConnectionStatusChanged += c.ConnectionChanged;
            if (c.Device.ConnectionStatus == BluetoothConnectionStatus.Disconnected) throw new Exception();
            CheckCurrent(c); c.Gate.Open(); complete = true;
            Status("connected");
        } catch (Exception error) {
            if (IsCurrent(c)) {
                if (stage == "subscribe_notifications" || stage == "read_services" || stage == "discover_characteristics") refreshCache = true;
                if (stage == "subscribe_notifications") Status("check_windows_pairing_if_repeated");
                Status("connection_failed_" + stage + "_hr_" + error.HResult.ToString("x8"));
            }
        }
        finally { if (!complete) { Release(c); c.Dispose(); } Interlocked.Exchange(ref connecting, 0); }
    }
    static async Task Input() {
        string line;
        while ((line = await Console.In.ReadLineAsync()) != null) {
            if (line.Length > 16000) break;
            Connection c = null;
            try {
                var msg = Json.Deserialize<Dictionary<string, object>>(line);
                var type = (string)msg["type"];
                lock (StateLock) c = connection;
                if (c == null || !msg.ContainsKey("connectionId") || Convert.ToInt32(msg["connectionId"]) != c.Id) continue;
                if (type == "ping") {
                    if (c.Device != null && c.Device.ConnectionStatus == BluetoothConnectionStatus.Connected) Emit(new { type = "pong", connectionId = c.Id });
                    else Release(c);
                    continue;
                }
                if (type == "disconnect") { Release(c); continue; }
                if (type != "write" || c.Receive == null) continue;
                var bytes = Convert.FromBase64String((string)msg["data"]);
                if (bytes.Length > 244) throw new Exception();
                await Writes.WaitAsync();
                try {
                    CheckCurrent(c); if (c.Receive == null) throw new Exception();
                    using (var writer = new DataWriter()) {
                        writer.WriteBytes(bytes);
                        var result = await Await(c.Receive.WriteValueAsync(writer.DetachBuffer(), GattWriteOption.WriteWithResponse)); CheckCurrent(c);
                        if (result != GattCommunicationStatus.Success) throw new Exception();
                        Emit(new { type = "written", connectionId = c.Id, id = msg["id"] });
                    }
                } finally { Writes.Release(); }
            } catch { Status("write_failed"); if (c != null) Release(c); }
        }
        stopping = true;
    }
    static async Task Run(string hostName, bool pairing) {
        expectedName = "MirTar-" + hostName;
        var radio = await Await(BluetoothAdapter.GetDefaultAsync());
        if (radio == null || !radio.IsCentralRoleSupported) { Status("bluetooth_unavailable"); return; }
        {
            var watcher = new BluetoothLEAdvertisementWatcher { ScanningMode = BluetoothLEScanningMode.Active };
            DateTime retryAt = DateTime.MinValue;
            watcher.Received += async (s, e) => {
                string name = e.Advertisement.LocalName;
                bool matches = pairing ? name != null && name.StartsWith("MirTar-Add-") && name.Length == 17 : name == expectedName;
                if (!matches || DateTime.UtcNow < retryAt) return;
                retryAt = DateTime.UtcNow.AddSeconds(8);
                await Connect(e.BluetoothAddress);
            };
            watcher.Stopped += (s, e) => Status("scan_stopped");
            watcher.Start(); Status("scanning");
            await Input(); watcher.Stop(); Release();
        }
    }
    static async Task<int> ForgetPairing(string hostName) {
        string name = "MirTar-" + hostName;
        // This mode is invoked explicitly by the local owner. Never unpair on an
        // advertisement or a communication failure: either could be spoofed.
        var records = await Await(DeviceInformation.FindAllAsync(BluetoothLEDevice.GetDeviceSelectorFromPairingState(true)));
        var matches = records.Where(d => String.Equals(d.Name, name, StringComparison.OrdinalIgnoreCase)).ToArray();
        if (matches.Length == 0) { Status("unpair_no_matching_record"); return 0; }
        if (matches.Length != 1) { Status("unpair_ambiguous_use_windows_settings"); return 3; }
        var result = await Await(matches[0].Pairing.UnpairAsync());
        Status("unpair_result_" + result.Status.ToString().ToLowerInvariant());
        return result.Status == DeviceUnpairingResultStatus.Unpaired || result.Status == DeviceUnpairingResultStatus.AlreadyUnpaired ? 0 : 1;
    }
    [STAThread] public static int Main(string[] args) {
        try {
            if (args.Length < 1 || args.Length > 2 || args.Length == 2 && args[1] != "--pair" && args[1] != "--forget") return 2;
            if (!System.Text.RegularExpressions.Regex.IsMatch(args[0], "^[a-zA-Z0-9_-]{1,20}$")) return 2;
            if (args.Length == 2 && args[1] == "--forget") return ForgetPairing(args[0]).GetAwaiter().GetResult();
            Run(args[0], args.Length == 2).GetAwaiter().GetResult(); return 0;
        }
        catch { Status("bluetooth_unavailable"); return 1; }
    }
}
