# 卡片与 Windows 桥接使用说明

[English](device-quickstart.md)

**v0.3.1：** 开机先选电脑，再选 Bluetooth（默认）或 Wi-Fi；不再自动连接。
首次蓝牙配对、电脑名称配置和操作步骤见 [0.3.0 蓝牙说明](bluetooth-0.3.0.zh_CN.md)。
下文原有 M1 Wi-Fi 设置仍适用于选择 Wi-Fi 的路径。

这是用于 Windows、可信局域网和已有 Codex 桌面会话的开发版本。仓库保持私有；真实配置、录音、提交回执、工具链和固件保存在被忽略的本地路径。不使用云端注册或热点配网。

## 填写配置

参考 `config/device.example.json`，在本机填写 `.private/device.config.json`，移除 `"template": true`。`wifiNetworks` 支持 0–8 组 SSID/password（只用蓝牙时可为空），按顺序尝试；当前网络连接失败后尝试下一项，全部失败后循环重试。板卡仅支持 2.4 GHz Wi-Fi。目标电脑地址必须在实际连接的网络中可达；连上 Wi-Fi 不代表一定能连上配置的电脑。

`targets` 最多配置四台电脑，每项有自己的局域网 WebSocket 地址和绑定密钥。`.private/bridge.config.json` 中的 `deviceId` 和授权密钥必须对应，密钥使用至少 32 字符的随机值。会话由 Codex 维护，桥接只引用已有原生 ID，不创建替代会话。最多开放八个桌面会话，显示名称限制为 60 UTF-8 字节。

桥接默认端口为 **TCP 28743**，可以修改。每个卡片目标 URL 的端口必须与那台电脑的桥接 `listen.port` 和防火墙规则一致。配置助手新建配置时可传入 `-Port <端口号>`。修改卡片目标端口后需要重新编译并刷入固件；修改桥接配置后需要重启桥接。

也可用 PowerShell 7 运行本机配置助手：

```powershell
.\tools\New-LocalConfig.ps1 -SessionId <原生会话UUID> -BridgeAddress <电脑局域网IPv4>
.\tools\New-LocalConfig.ps1 -AddWiFi
```

助手在本机询问 SSID，隐藏输入密码，并自动生成匹配的绑定密钥；不要把密码发到聊天或提交配置文件。已有配置不会被覆盖。修改 `skin` 为 `reading` 或 `terminal` 选择候选皮肤。

## 启动与构建

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run check
npm.cmd test
.\tools\Start-Bridge.ps1
# 另开一个终端：
.\tools\Build-Firmware.ps1
```

构建脚本使用 `.private/toolchains` 下项目隔离的 ESP-IDF 5.5.6。工具链不存在时，按官方 ESP-IDF 安装流程准备，不覆盖已有全局工具链。`Build-Firmware.ps1 -Config .private/compile.config.json -CompileCheck` 仅验证占位配置可编译，不是能连接实际 Wi-Fi 的交付版本。

桥接仅监听指定网卡，通过 HMAC 挑战应答校验设备绑定。M1 显式使用未加密的局域网 WebSocket（`allowLanPlaintext: true`），录音和回复流量不加密。不自动修改防火墙或做端口映射；Windows 如询问防火墙访问，只按实际需要允许对应桥接程序访问可信专用网络。网络策略和电脑可达性需要在使用环境确认。

## 刷入与操作

使用真实配置构建成功后，`firmware/build/MirTar-full.bin` 是写入 **0x0** 的完整镜像。`firmware/build/mirtar-manifest.json` 记录它与对应 ELF 的哈希，`verify_firmware.py` 会把实际刷入段逐项与合并镜像核对。不要刷入占位构建，也不要把应用单独的 `MirTar.bin` 写到 0x0。

准备自行刷入时，用实际串口运行 `tools/Flash-Firmware.ps1 -Port COMx`。脚本核对镜像哈希并拒绝占位构建；`-WhatIf` 可预览操作，`-PreserveNvs` 仅写入已核对的分段，前提是原有分区布局兼容。构建前会强制重新配置，避免误用上一份嵌入配置。

刷入会替换当前应用；完整镜像可能重置原有设置，不需要默认全片擦除。如果要保留 NVS，确认分区兼容后使用分段刷入。本文不授权 Agent 对任意已连接设备自动刷机。

本机 Windows 上真实编译工具查询偶发返回空或截断的 stdout。构建脚本会在项目私有 SDK 的编译器和链接元数据助手应用有记录的有限重试；链接元数据必须与实际 ELF 归档的每个成员、节名和大小一致，并通过 SDK 语法解析，不生成替代数据。持续失败仍会终止；没有更改杀毒、终端防护、证书或全局 shell 设置。

开机后选择电脑，按 OK 选择连接方式。Bluetooth 默认选中；选择 Wi-Fi 时依次尝试预置网络，然后连接所选电脑并校验绑定。只有一个可用会话时自动打开；多个会话时用上下和 OK 选择。

- 短按 OK 开始录音，再短按 OK 结束并提交；提交前缓存在桥接的录音不会发给 Codex。
- 短按上下翻阅内容；未录音时长按上下切换会话。
- 长按 OK 取消尚未提交的录音并返回电脑列表；不会取消电脑端已经接受的任务。
- 单次录音最多 30 秒；达到上限或断网时取消尚未提交的输入。
- 原生提交结果未知时不自动重发；再次发起前先到电脑确认。

## 当前限制

适配器使用现有登录的 Codex 原生 WebRTC v3 处理语音，再通过原生队列提交到指定桌面会话，不新增 ASR 模型、服务或 API Key；账号原生语音权限与服务限制依然适用。Microsoft Edge 以独立的项目私有无界面配置目录充当本机 WebRTC 媒体引擎。

当前只展示已完成的正式 Agent 回复，历史读取路径不能可靠提供工具实时进展和审批状态；审批仍在电脑处理。本次尚未实现可选 TTS/卡片朗读，并在能力声明中明确关闭。

16px 字库包含 7,540 个已验证光栅打包的字符，覆盖可打印 ASCII、GB2312 和固定界面补充。未覆盖字符（包括许多 emoji、生僻字）保留可见的缺字占位，完整回复以桌面为准。中文实际渲染、麦克风音量、实体按键、音频时序、电量、Wi-Fi 轮换、内存与真实屏幕布局仍需真机验收。
