# 卡片与 Windows 桥接使用说明

[English](device-quickstart.md)

v0.4.0 使用同一份无私人配置的固件，通过卡片热点保存网络和电脑配置；不再把密码编进固件。
完整引导见[热点配网](wifi-setup.zh_CN.md)。无线与屏幕验收结果见版本验证记录，主机测试不能替代真机测试。

## 准备电脑配置

需要 Windows、Node.js 24.13.0+、Microsoft Edge、已登录的 Codex 桌面应用及一个专用会话。
配置可在 Windows PowerShell 5.1 或 PowerShell 7 中运行；下方固件编译使用 PowerShell 7：

```powershell
npm.cmd ci --ignore-scripts
# 仅使用蓝牙，不需要家庭 Wi-Fi：
.\tools\New-LocalConfig.ps1 -BluetoothOnly
# 或：使用局域网，只在电脑填写其正常局域网地址，Wi-Fi 留到卡片网页：
.\tools\New-LocalConfig.ps1 -NoWiFiPrompt
```

两个配置命令选择其一。助手生成 `.private/device.config.json` 与 `.private/bridge.config.json`，
询问已有 Codex 会话 ID，并在本机随机生成对应的绑定密钥。已有配置不会被覆盖，可直接使用自己原来的文件。
卡片最多四台电脑、八组 Wi-Fi；多个电脑请写入同一份设备配置的 `targets`。
`deviceId` 和密钥必须与对应电脑的桥接一致，蓝牙名称也要匹配。

默认端口 TCP 28743，可通过 `-Port` 设置。Wi-Fi 使用时，卡片目标 URL、桥接监听端口与防火墙一致，
只放行可信专用局域网；程序不自动修改防火墙或建立公网入口。蓝牙不依赖局域网端口。
修改电脑或端口后在配置网页重新导入设备文件，桥接配置修改后重启桥接，均无需重编译固件。

## 编译与刷入

构建需要 ESP-IDF 5.5.6，项目脚本使用 `.private/toolchains` 中的隔离工具链。
不要覆盖自己已有的全局工具链；也可以在匹配的官方 ESP-IDF 环境中使用 idf.py。

```powershell
.\tools\Build-Firmware.ps1
# 仅预览，不操作设备：
.\tools\Flash-Firmware.ps1 -Port COMx -PreserveNvs -WhatIf
# 在确认串口和分区兼容后，由你自行执行：
.\tools\Flash-Firmware.ps1 -Port COMx -PreserveNvs
```

本版默认产物位于 `.private/build-v0.4.0/`。`MirTar-full.bin` 是写入 **0x0** 的完整镜像，
不能用应用单镜像 `MirTar.bin` 替代。构建验证工具核对实际分段与合并镜像，记录 SHA256 和版本。
`-BuildDirectory` 可显式选择其他构建目录。构建不读取真实配置，旧 `-Config` 参数会报错并提示改用运行时导入。

`-PreserveNvs` 只写应用所需分段，要求原有分区布局兼容；完整合并刷写可能清掉 NVS。
NVS 保存新配置和蓝牙配对记录，不默认全片擦除。本文不授权 Agent 自动刷写连接的设备。
v0.3.x 编译进去的配置不会自动迁移，请通过新引导导入本机原有设备配置文件。

## 首次配置与连接

1. 卡片选择 Wi-Fi；无保存网络时立即显示热点，有网络但 30 秒未连上时自动进入。
2. 手机扫码连接屏幕上的 `MirTar-Setup-XXXXXX`，或手动输入屏幕随机密码；保持连接这个没有互联网的热点，浏览器访问 `http://192.168.4.1`。
3. 填写 2.4 GHz Wi-Fi，保存并等待结果。失败可在同一网页修改重试；换网时在 Wi-Fi 连接页长按上键重新打开配网。
4. 首次还需电脑连接此热点，打开同一网页并导入自己的 `.private/device.config.json`。只用蓝牙时点“只导入电脑配置，使用蓝牙”，不必填写家庭 Wi-Fi。
5. 电脑切回原网络，启动 `.\tools\Start-Bridge.ps1`。卡片选电脑与连接方式；有电脑配置后默认 Bluetooth。首次在 Windows 输入卡片六位配对码。

Wi-Fi 保存到卡片 NVS，电脑上的 JSON 不会自动同步手机填写的内容。
如果 Wi-Fi 已连上而还没有电脑配置，热点继续保留，直到导入或长按 OK 退出。
桥接本身不可达不会触发 Wi-Fi 的 30 秒配网计时。

## 日常操作与限制

- OK 开始录音，再按 OK 提交；单次最多 30 秒。
- 上下翻阅回复，未录音时长按上下切换会话。
- 长按 OK 取消未提交录音并返回电脑选择；电脑已经接受的任务不会因此取消。
- 单会话自动进入，多会话用上下和 OK 选择。未知提交不会自动重放。

会话由 Codex 维护，桥接使用其原生语音，不增加 ASR 服务或 API Key。电脑仍需正常访问 Codex。
当前仅显示已完成回复；TTS、实时工具进度、卡片审批、Cursor 和其他 OS 尚未实现。
Wi-Fi 业务流量为可信局域网明文，BLE 使用认证加密和应用绑定。卡片 NVS 尚未加密。
私有配置、录音、ELF、设备日志和回执仍须留在忽略路径；公开固件只应包含通用程序。
字库未覆盖的字符会显示占位，完整内容以桌面为准。持续吞吐、功耗和实体操作仍须真机验收。
