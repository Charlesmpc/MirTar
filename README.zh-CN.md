# MirTar

**把电脑上的编程 Agent，带到手里。**

[English](README.md) · [版本下载](https://github.com/Charlesmpc/MirTar/releases) · [使用说明](docs/device-quickstart.zh_CN.md)

MirTar 把 FoloToy AI Passport 卡片变成**电脑上编程 Agent 的随身控制器和回复屏幕**。
不用戴耳机或一直凑到电脑麦克风前：按 OK 说话，再按 OK 发送，在卡片上阅读回复；
回到电脑后仍能继续操作**同一个 Agent 会话**。

做它的起因很简单：作者此前尝试通过手机上的 ChatGPT 远程连接电脑，但在自己的使用中经常断开。
于是把卡片到电脑的连接放到**局域网 Wi-Fi 或蓝牙**，配上实体按键和可以直接看回复的屏幕。

| 方式 | 能提供什么 | 为什么还需要 MirTar？ |
| --- | --- | --- |
| 蓝牙耳机 | 方便的麦克风和音频 | 缺少 Agent 会话选择控制器和文字回显；MirTar 提供专用按键与回复屏幕。 |
| 手机 App／云端远程连接 | 熟悉的屏幕和语音入口 | 经云端中转的控制依赖公网，作者此前使用时经常断开；MirTar 经 LAN 或蓝牙直接连到电脑。 |
| MirTar 卡片 | 语音输入、会话控制和回复显示 | 约 [50g](https://ai-passport.folotoy.cn/)，拿着比手机轻；操作 Agent 时，手机仍可以做别的事情。 |

**把控制链路留在本地。** 卡片与电脑之间无需云端中转，无需给桥接开放公网入口或配置端口映射。
蓝牙配对或接入可信局域网后，就可以按键说话。Agent 自身访问 Codex 服务仍需正常联网，
这不等于离线运行 Agent。BLE 使用认证加密和应用绑定；Wi-Fi 当前仍为明文，只适合可信局域网。

**OS 适配层独立于 Agent 和设备协议**：目前实现 Windows 桥接，后续计划实现 macOS、Linux。
当前 Agent 适配器是 Codex。**v0.4.0 增加运行时配网**：选择 Wi-Fi 后，无网络配置立即打开卡片热点，
有配置但 30 秒未连接也自动进入；扫码连接后访问 `http://192.168.4.1`，保存 Wi-Fi 并导入自己的电脑配置。
固件不再嵌入私人密码或绑定密钥。只用蓝牙时也可导入电脑配置，不必填写家庭 Wi-Fi。
详见[热点配网指南](docs/wifi-setup.zh_CN.md)。

本次配网为测试版；编译与主机检查不代表真机验收。

## 流程与操作

卡片 → Bluetooth（默认）或局域网 Wi-Fi → 桥接（设备传输／OS 适配／Agent 适配）→ 已有会话 → 回复回到卡片。
目前接入 Windows 和 Codex；macOS、Linux 将通过各自的 OS 适配实现接入。
桥接不另接 ASR 服务，也不要求额外 ASR API Key。会话、上下文和执行由 Codex 管理。
蓝牙模式不需要卡片和笔记本共享 Wi-Fi；电脑访问 Codex 本身仍可能需要互联网及原生语音额度。

1. 开机选电脑，OK 进入连接方式，默认选中 Bluetooth。
2. 首次连接在 Windows 输入卡片上的六位码，后续复用配对记录。
3. 进入已有会话；只有一个时自动打开。
4. OK 开始录音，再次 OK 提交；上下翻阅，长按上下切会话，长按 OK 返回电脑选择。

## 开始使用

需要 AI Passport、支持 BLE 的 Windows、Node.js **24.13.0+**、Microsoft Edge、
已登录的 Codex 桌面应用及其可执行程序。编译固件使用 **ESP-IDF 5.5.6 / LVGL 9.5.0**；
配置助手支持 Windows PowerShell 5.1 和 PowerShell 7；编译助手使用 PowerShell 7。

```powershell
npm.cmd ci --ignore-scripts
# 仅新建配置，不覆盖已有文件：
.\tools\New-LocalConfig.ps1 -BluetoothOnly -BluetoothName WorkLaptop
```

助手在本机询问原生会话 ID，生成匹配的私有配置。刷入通用固件后，用电脑连接卡片热点，
打开 `http://192.168.4.1`，导入 `.private/device.config.json`，选择只使用蓝牙；
电脑切回原网络后再启动桥接。若使用局域网，将配置命令改为 `-NoWiFiPrompt`，在配网页面填写家庭 Wi-Fi。
卡片 `bluetoothName` 必须与桥接 `bluetooth.hostName` 一致。
升级 v0.3.x 时需重新刷入新固件并导入旧配置；旧固件里的编译配置不会自动迁移。保留原文件与已验证镜像作回退。

- [蓝牙配对、配置和排错](docs/bluetooth-0.3.0.zh_CN.md)
- [固件编译与刷入](docs/device-quickstart.zh_CN.md)
- [Windows 桥接下载包](docs/windows-bridge-package.zh_CN.md)
- [v0.4.0 发布说明](docs/releases/v0.4.0.zh_CN.md)

源码和桥接包只含占位模板。新版固件是通用程序，刷入后在卡片引导中配置；
旧版含私人配置的镜像仍须留在本机，不能上传。

## 当前边界

当前已实现 Windows OS 适配器和 Codex Agent 适配器，版本内同时提供 BLE 和可信局域网 Wi-Fi、
已有会话的原生语音输入、正式文字回复和两套皮肤。OS 层独立，macOS、Linux 实现在后续计划中。
尚未实现 TTS/朗读、实时工具进度、审批界面、Cursor、云端配网和 OTA。
单次录音最多 30 秒，不完整输入不会提交，提交状态未知不会自动重放。
卡片走自定义 BLE GATT，并非系统通用蓝牙耳机。Codex 实验接口受版本影响；
持续吞吐、续航、休眠恢复、多电脑和连接方式切换仍需更广泛验收。

## 配置与保密

`config/` 只放占位模板，真实配置只放 `.private/`。Wi-Fi 最多八组 SSID/password，
只用蓝牙时可以是空数组。新版配置写入卡片 NVS，固件不再编入私人凭据；NVS 当前尚未加密。
私人配置、旧版个性化固件、ELF、录音、日志和原生会话 ID 都不要提交或上传。
蓝牙使用认证加密，随后再校验 HMAC；Wi-Fi 是显式开启的可信局域网明文连接，不应暴露到公网。
程序不会自动修改防火墙或做端口映射。

```powershell
npm.cmd run hooks:install
npm.cmd run security:check
npm.cmd run audit:privacy
```

提交检查拦截本机凭据及私有/生成文件，隐私检查还会扫描可达 Git 历史并单列个人元数据。
自动扫描不代表绝对无泄露。公开仓库从已审计的源码快照开始，不包含此前的私有开发历史。
使用者仍需将自己的配置和构建产物保留在本机。

设备传输、Agent 和 OS 适配分别组织。新增 OS 时，在该边界内实现对应的媒体、BLE 等平台功能，
保留卡片协议和 Agent 会话模型；当前启动入口接入 Windows 实现。

[产品设计](DESIGN.md) · [技术设计](TECH_DESIGN.md) · [上游来源](firmware/UPSTREAM.zh_CN.md) · [社区发布准备](docs/community-publishing.zh_CN.md)
