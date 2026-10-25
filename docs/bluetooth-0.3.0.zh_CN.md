# 0.3.0：Bluetooth 与 Wi-Fi

0.2.0 是已通过用户真机演示的局域网版本，Git 标签 `v0.2.0`。
0.3.0 在此基础上增加 BLE，继续由原有 Codex 桌面会话维护任务和历史。

## 卡片操作

1. 开机后选择电脑，例如 WorkLaptop 或 Desktop。
2. 按 OK 进入连接方式：默认选中 **Bluetooth**，上下切换到 Wi-Fi。
3. 选择 Bluetooth 后，卡片广播 `MirTar-<bluetoothName>`，等待对应电脑桥接。
4. 首次连接时卡片显示六位配对码，Windows 弹出 MirTar 配对窗口，输入卡片上的码。
5. 配对记录保存在 Windows 和卡片 NVS。后续连接不重复询问配对码。
6. 蓝牙连接之后仍需通过原来的 HMAC 绑定校验，才会显示该电脑开放的会话。
7. 单个会话自动打开；多个会话按上下和 OK 选择。两次 OK 录音/提交的操作不变。
8. 长按 OK 取消未提交录音、断开连接并返回电脑列表。已被 Codex 接受的任务可能继续执行。

开机不再自动连接第一台电脑，也不再先等待 Wi-Fi。不会在蓝牙失败后自动改走 Wi-Fi；选择连接方式由用户控制。

## Windows 配置与启动

Node.js 24、Codex 和 Edge 的依赖不变。蓝牙部分使用 Windows 自带 .NET Framework
编译器和 WinRT API，在桥接内部启动辅助进程，不需要另外安装 .NET SDK、NuGet 包或 ASR 服务。
需要 Windows 蓝牙适配器支持 BLE Central。

卡片每个目标的 `bluetoothName` 要与对应桥接的 `bluetooth.hostName` 一致，区分大小写；
省略前者时使用目标 `name`，省略后者时使用 Windows 系统主机名。**电脑显示名 WorkLaptop
不一定等于 Windows 主机名**，因此已有配置推荐明确设置：

```powershell
cd C:\Projects\MirTar
.\tools\Enable-Bluetooth.ps1 -HostName WorkLaptop
.\tools\Start-Bluetooth.ps1 -CompileOnly
.\tools\Start-Bridge.ps1
```

另一台电脑设置为 `Desktop`。更新该电脑专用的配置文件可传 `-Config`。
首次弹窗的配对码由卡片生成，不能从聊天或配置模板获得。

已修复首次实测发现的 Windows 服务发现错误和已配对重连丢失首条通知的问题。
这项修复只更新桥接，不需要重刷 0.3.0 固件，也不需要删除已有配对。
更新代码后重启桥接即可。连接日志会分别显示配对、服务数量、数据通道数量和订阅结果，
失败时包含阶段与 HRESULT；不会输出配对码或语音内容。

新建配置可使用 `New-LocalConfig.ps1 -BluetoothOnly -BluetoothName WorkLaptop`；
这时 `wifiNetworks` 可以是空数组。已有配置助手不会覆盖凭据。
要完全关闭蓝牙，显式设置 `bluetooth.enabled: false` 并重启桥接。

笔记本切换网络导致原来的 LAN IP 不存在时，桥接改在回环地址监听原有协议，
BLE 继续工作；Wi-Fi 目标 URL 仍需在实际网络中可达。蓝牙链路不需要放行局域网 TCP 防火墙端口。
Codex 自身的登录、模型和原生语音服务依然可能需要互联网；BLE 只替代卡片到电脑的网络。

## 构建与刷入

真实配置和固件仍只放在 `.private/` 或被忽略的构建目录。

```powershell
.\tools\Build-Firmware.ps1
.\tools\Flash-Firmware.ps1 -Port COMx -PreserveNvs
```

默认产物仍为 `firmware/build/MirTar-full.bin`，完整镜像写到 0x0。
`-PreserveNvs` 使用分段写入，须与已有分区兼容。不要全片擦除，否则会丢失蓝牙配对记录。
`Flash-Firmware.ps1` 同样接受 `-BuildDirectory`，必须指向本次真实配置构建的目录。
构建脚本也支持 `-BuildDirectory <目录>` 生成隔离的测试构建；此目录及其 sdkconfig 不影响旧的 0.2.0 构建。
占位模板固件只能检查编译，不能用于实际连接。

## 协议、安全和限制

ESP32-C3 使用 BLE 自定义 GATT 服务，不是系统标准蓝牙麦克风/扬声器。
卡片传送 PCM 16 kHz / 16 bit / mono；桥接没有新增 ASR。
BLE 使用加密、认证、持久化配对；应用层继续使用原来的每台电脑独立绑定密钥。
名称匹配只用于发现，不是授权依据。当前 Windows 辅助进程一次服务一张卡片。

BLE 把既有 JSON 和 MTA1 音频按 ATT MTU 分包，检查总长度、偏移和连续消息号。
丢包、乱序、流量过大或断线不能继续提交不完整录音。已经提交或状态未知的输入不会自动重放。
Wi-Fi 保留原来的显式可信 LAN 明文模式。

若 Windows 和卡片的配对记录不一致，当前版本拒绝静默删除旧绑定。
需要在 Windows 删除旧设备，并用受控方式清除卡片相应 bond 后重新配对；
当前 UI 尚不提供删除指定 bond 的菜单，不应为此直接擦除整个 NVS。

真机验收需检查首次配对、重启重连、双电脑切换、30 秒录音完整性、蓝牙距离/功耗、
休眠唤醒及 Wi-Fi 回退。主机模拟测试不能替代无线链路验收。
