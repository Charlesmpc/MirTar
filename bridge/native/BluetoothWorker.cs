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
    static BluetoothLEDevice device;
    static GattDeviceService service;
    static GattSession session;
    static GattCharacteristic receive, transmit;
    static string expectedName;
    static int connecting, epoch;
    static bool stopping;
    static void Emit(object message) { lock (OutputLock) { Console.WriteLine(Json.Serialize(message)); Console.Out.Flush(); } }
    static void Status(string code) { Emit(new { type = "status", code = code }); }
    static async Task<T> Await<T>(Windows.Foundation.IAsyncOperation<T> operation) {
        var deadline = DateTime.UtcNow.AddSeconds(90);
        while (operation.Status == Windows.Foundation.AsyncStatus.Started) {
            if (DateTime.UtcNow > deadline) { operation.Cancel(); throw new TimeoutException(); }
            await Task.Delay(15);
        }
        try { return operation.GetResults(); } finally { operation.Close(); }
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
    static void Release() {
        Interlocked.Increment(ref epoch);
        if (transmit != null) transmit.ValueChanged -= ValueChanged;
        transmit = receive = null;
        if (device != null) device.ConnectionStatusChanged -= ConnectionChanged;
        if (session != null) { session.MaxPduSizeChanged -= MtuChanged; session.MaintainConnection = false; session.Dispose(); session = null; }
        if (service != null) { service.Dispose(); service = null; }
        if (device != null) { device.Dispose(); device = null; }
    }
    static void ConnectionChanged(BluetoothLEDevice sender, object args) {
        if (sender.ConnectionStatus == BluetoothConnectionStatus.Disconnected) {
            Emit(new { type = "disconnected" }); Release();
        }
    }
    static void ValueChanged(GattCharacteristic sender, GattValueChangedEventArgs args) {
        using (var reader = DataReader.FromBuffer(args.CharacteristicValue)) {
            var bytes = new byte[reader.UnconsumedBufferLength]; reader.ReadBytes(bytes);
            Emit(new { type = "packet", data = Convert.ToBase64String(bytes) });
        }
    }
    static void MtuChanged(GattSession sender, object args) {
        Emit(new { type = "mtu", valueSize = Math.Min(244, (int)sender.MaxPduSize - 3) });
    }
    static async Task Connect(ulong address) {
        if (device != null || stopping || Interlocked.CompareExchange(ref connecting, 1, 0) != 0) return;
        BluetoothLEDevice candidate = null;
        string stage = "open_device";
        try {
            candidate = await Await(BluetoothLEDevice.FromBluetoothAddressAsync(address));
            if (candidate == null) throw new Exception();
            if (!candidate.DeviceInformation.Pairing.IsPaired) {
                stage = "pair_device";
                Status("pairing_required");
                var custom = candidate.DeviceInformation.Pairing.Custom;
                custom.PairingRequested += PairingRequested;
                try {
                    var paired = await Await(custom.PairAsync(DevicePairingKinds.ProvidePin, DevicePairingProtectionLevel.EncryptionAndAuthentication));
                    Status("pair_result_" + paired.Status.ToString().ToLowerInvariant());
                    if (paired.Status != DevicePairingResultStatus.Paired && paired.Status != DevicePairingResultStatus.AlreadyPaired) {
                        Status("pairing_failed"); return;
                    }
                } finally { custom.PairingRequested -= PairingRequested; }
            }
            Status("paired");
            stage = "create_session";
            session = await Await(GattSession.FromDeviceIdAsync(candidate.BluetoothDeviceId));
            session.MaxPduSizeChanged += MtuChanged;
            stage = "discover_service";
            var discovery = candidate.GetGattServicesAsync(BluetoothCacheMode.Cached);
            stage = "await_service";
            var services = await Await(discovery);
            stage = "read_services";
            Status("service_" + services.Status.ToString().ToLowerInvariant() + "_count_" + services.Services.Count);
            if (services.Status != GattCommunicationStatus.Success) throw new Exception();
            foreach (var found in services.Services) {
                if (found.Uuid == Service && service == null) service = found;
                else found.Dispose();
            }
            if (service == null) throw new Exception();
            stage = "discover_characteristics";
            var characteristics = await Await(service.GetCharacteristicsAsync(BluetoothCacheMode.Cached));
            Status("characteristics_" + characteristics.Status.ToString().ToLowerInvariant() + "_count_" + characteristics.Characteristics.Count);
            if (characteristics.Status != GattCommunicationStatus.Success) throw new Exception();
            receive = characteristics.Characteristics.SingleOrDefault(c => c.Uuid == Rx);
            transmit = characteristics.Characteristics.SingleOrDefault(c => c.Uuid == Tx);
            if (receive == null || transmit == null) throw new Exception();
            stage = "set_protection";
            receive.ProtectionLevel = GattProtectionLevel.EncryptionAndAuthenticationRequired;
            transmit.ProtectionLevel = GattProtectionLevel.EncryptionAndAuthenticationRequired;
            // Bonded CCCDs can restore automatically on reconnect. Register the
            // handler before maintaining the link so the first hello is observed.
            device = candidate; candidate = null;
            transmit.ValueChanged += ValueChanged;
            Emit(new { type = "connected", valueSize = Math.Min(244, (int)session.MaxPduSize - 3) });
            session.MaintainConnection = true;
            stage = "subscribe_notifications";
            var result = await Await(transmit.WriteClientCharacteristicConfigurationDescriptorAsync(GattClientCharacteristicConfigurationDescriptorValue.Notify));
            Status("subscribe_" + result.ToString().ToLowerInvariant());
            if (result != GattCommunicationStatus.Success) throw new Exception();
            device.ConnectionStatusChanged += ConnectionChanged;
            if (device.ConnectionStatus == BluetoothConnectionStatus.Disconnected) throw new Exception();
            Status("connected");
        } catch (Exception error) { Status("connection_failed_" + stage + "_hr_" + error.HResult.ToString("x8")); Emit(new { type = "disconnected" }); Release(); }
        finally { if (candidate != null) candidate.Dispose(); Interlocked.Exchange(ref connecting, 0); }
    }
    static async Task Input() {
        string line;
        while ((line = await Console.In.ReadLineAsync()) != null) {
            if (line.Length > 16000) break;
            try {
                var msg = Json.Deserialize<Dictionary<string, object>>(line);
                var type = (string)msg["type"];
                if (type == "ping") {
                    if (device != null && device.ConnectionStatus == BluetoothConnectionStatus.Connected) Emit(new { type = "pong" });
                    else { Emit(new { type = "disconnected" }); Release(); }
                    continue;
                }
                if (type == "disconnect") { Release(); Emit(new { type = "disconnected" }); continue; }
                if (type != "write" || receive == null) continue;
                int current = epoch;
                var bytes = Convert.FromBase64String((string)msg["data"]);
                if (bytes.Length > 244) throw new Exception();
                await Writes.WaitAsync();
                try {
                    if (current != epoch || receive == null) throw new Exception();
                    using (var writer = new DataWriter()) {
                        writer.WriteBytes(bytes);
                        var result = await Await(receive.WriteValueAsync(writer.DetachBuffer(), GattWriteOption.WriteWithResponse));
                        if (result != GattCommunicationStatus.Success) throw new Exception();
                        Emit(new { type = "written", id = msg["id"] });
                    }
                } finally { Writes.Release(); }
            } catch { Status("write_failed"); Emit(new { type = "disconnected" }); Release(); }
        }
        stopping = true;
    }
    static async Task Run(string hostName) {
        expectedName = "MirTar-" + hostName;
        var radio = await Await(BluetoothAdapter.GetDefaultAsync());
        if (radio == null || !radio.IsCentralRoleSupported) { Status("bluetooth_unavailable"); return; }
        {
            var watcher = new BluetoothLEAdvertisementWatcher { ScanningMode = BluetoothLEScanningMode.Active };
            DateTime retryAt = DateTime.MinValue;
            watcher.Received += async (s, e) => {
                if (e.Advertisement.LocalName != expectedName || DateTime.UtcNow < retryAt || device != null) return;
                retryAt = DateTime.UtcNow.AddSeconds(8);
                await Connect(e.BluetoothAddress);
            };
            watcher.Stopped += (s, e) => Status("scan_stopped");
            watcher.Start(); Status("scanning");
            await Input(); watcher.Stop(); Release();
        }
    }
    [STAThread] public static int Main(string[] args) {
        try { if (args.Length != 1) return 2; Run(args[0]).GetAwaiter().GetResult(); return 0; }
        catch { Status("bluetooth_unavailable"); return 1; }
    }
}
