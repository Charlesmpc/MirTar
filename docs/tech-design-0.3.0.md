# MirTar 0.3.0 技术设计增量与任务

2026-10-25。基线：`v0.2.0`。目标：Windows / Codex，BLE 默认、Wi-Fi 可选。
产品边界沿用 DESIGN.md，无单独 Spec。会话依旧由 Agent 维护，桌面可见/可继续操作。

## 交互

开机显示已配置机器列表 → OK → 连接方式（默认 Bluetooth） → OK 连接 → 选择/打开已有会话。
切换机器后再次默认 Bluetooth。不先启动 Wi-Fi，不自动回退网络。
已配对时重用 bond；首次通过卡片显示的六位 passkey 在 Windows 完成配对。
长按 OK 断开并回机器列表，两次短按 OK 录音/提交，上下翻阅、长按上下切会话沿用原交互。

## 分层

固件 `ble_transport.c` 使用 ESP-IDF 5.5.6 NimBLE GATT peripheral；Windows
内部 WinRT worker 作 central，TypeScript `windows-ble.ts` 适配 DevicePeer。
WebSocket 和 BLE 共用 server 的协议处理器、设备互斥、输入队列和 durable receipts。
AgentAdapter / WindowsMediaHost 保持原职责，不添加第二个会话管理器或 ASR。
协议定义见 bluetooth-protocol.md。语音仍是 PCM 16 kHz mono，回复仍是原生正式回复。

选择 BLE 时不启动 Wi-Fi。Wi-Fi 只在用户选中该路径后初始化并尝试预置网络。
切换时释放旧的 Wi-Fi 驱动/netif 或 NimBLE host/controller，避免两个协议栈同时占用有限堆内存。
BLE bond 持久化在现有 NVS，不改变分区；不擦除 NVS。两个 radio 不同时传输业务。
BLE / Wi-Fi 切换先协作停止音频，再增加连接 generation、关闭旧 transport。
任何未完成音频、分包缺口或断线不能自动提交/重放。

Windows 原生辅助程序属于桥接内部实现，使用系统 .NET Framework C# 编译器生成本地忽略目录中的 EXE。
无需单独安装 .NET SDK 或引入 Node 蓝牙原生依赖。自定义配对窗口在独立 STA 线程显示，
敏感数据不写日志。WinRT async operation 使用有上限的轮询封装，避免依赖 SDK 合并 WinMD。

`bluetoothName` 与 `bluetooth.hostName` 显式对应，分别缺省为目标显示名与系统 hostname。
已有 WorkLaptop 显示名与 WORK-LAPTOP 系统名不同，因此迁移必须配置明确名称。
原 LAN IP 不可绑定时，BLE 桥接仍启动，协议监听地址降为回环；不会开放 0.0.0.0。

## 任务与验收

- [x] T01：记录并推送 v0.2.0 基线；真实配置继续忽略。
- [x] T02：机器 → transport → 会话 UI；默认 BLE，Wi-Fi 延迟启动。
- [x] T03：GATT 分包协议、长度/连续性校验和有界重组。
- [x] T04：NimBLE 外设、安全配对、NVS bond、语音/JSON transport。
- [x] T05：Windows 配对/通知/写入 worker、Node DevicePeer 适配。
- [x] T06：共享协议抽象；BLE/Wi-Fi 并发绑定互斥。
- [x] T07：主机分包/异常测试、BLE 协议集成测试、Wi-Fi 回归。
- [x] T08：ESP-IDF 固件编译、分段/合并校验、静态 RAM 检查。
- [ ] T09：真实卡片首次配对、重启重连、选择不同电脑、录音/回复完整闭环。
- [ ] T10：BLE 持续吞吐、30 秒录音、范围、功耗、睡眠恢复、Wi-Fi 再连接验收。

代码和主机测试通过不等于真机验收。尤其 BLE 的实际 MTU、connection interval、
Windows 驱动调度和射频条件决定能否持续承载 32 KB/s PCM。
本版不新增 TTS、审批协议、Cursor 或跨平台原生蓝牙实现。

T09 部分进展：用户已输入 passkey，Windows 确认 bond；真实卡片连续两轮桥接进程重启后，
BLE / HMAC / 原生会话选择 / 已有回复传输通过。没有发送新语音；板卡重启、多电脑和
语音完整闭环仍待验收。Windows 使用完整服务枚举并本地过滤 UUID，在维持连接前注册通知，
避免 bond 恢复订阅时漏收 hello；协商 MTU 改变会同步给 TypeScript transport。
