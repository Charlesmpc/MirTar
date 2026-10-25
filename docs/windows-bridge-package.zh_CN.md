# Windows 桥接包使用说明

[English](windows-bridge-package.md)

预览版 ZIP 包含 Windows 桥接的 Node.js/TypeScript 源码、测试、启动助手和占位配置模板，依赖在本机安装。包内不含 Node.js、Codex、Microsoft Edge 或已配置的卡片固件。编译固件请使用完整源码包或仓库。

## 启动

1. 准备 Windows、PowerShell 7、Node.js 24.13.0 或更新版本、Microsoft Edge，以及已登录的 Codex 桌面应用。
2. 把 ZIP 解压到普通可写目录，在解压后的 `MirTar-windows-bridge` 文件夹中打开 PowerShell 7。
3. 安装锁定版本的依赖：

   ```powershell
   npm.cmd ci --ignore-scripts
   ```

4. 在该目录创建 `.private`。已有配置好的 badge 时，把与它匹配的桥接配置在本机复制为 `.private/bridge.config.json`。否则参考 `config/bridge.example.json`，填写实际局域网地址、设备 ID、匹配的绑定密钥、真实 Codex 可执行文件（`.exe`）路径、Edge 路径和已有桌面会话 UUID。模板不包含可用的绑定凭据。真实配置只保存在本机。
5. 选择 Wi-Fi 时，桥接 `listen.port`、卡片目标 URL 和 Windows 防火墙规则的端口必须一致，默认是 **TCP 28743**。防火墙仅放行可信专用局域网。保持 Codex 和目标桌面会话打开。
6. 启动：

   ```powershell
   .\tools\Start-Bridge.ps1
   ```

   使用另一份本机配置时，追加 `-Config .private/bridge.other.config.json`。
7. 蓝牙模式确认卡片 `bluetoothName` 和桥接 `bluetooth.hostName` 一致；等待 `Bluetooth: scanning`，首次输入卡片六位码。看到 `Bluetooth: connected` 后保持终端运行，Ctrl+C 停止桥接。局域网 IP 不存在时监听回环地址是正常情况。

可使用 `npm.cmd run check`、`npm.cmd test` 排查问题。此 ZIP 是运行所需的源码包，不是 Git 工作区或 Windows 安装程序；Git 提交钩子在克隆仓库后安装。

## 卡片与保密

卡片默认通过 Bluetooth LE，也可用可信局域网 Wi-Fi。v0.4.0 使用运行时配置：在卡片热点网页导入自己的设备 JSON，填写网络并保存到卡片，固件不再嵌入私人凭据。详见[热点配网](wifi-setup.zh_CN.md)与[卡片指南](device-quickstart.zh_CN.md)。旧版个性化固件、真实配置和 ELF 仍不得上传。

预览版显示已完成的回复，尚不支持 TTS 或可靠的工具实时进度／审批状态。验证边界见[发布说明](releases/v0.3.1.zh_CN.md)。

The bridge ZIP includes tools/Start-Bluetooth.ps1, tools/Enable-Bluetooth.ps1 and
bridge/native/BluetoothWorker.cs. Windows compiles the helper locally; no native
binary or .NET SDK download is bundled. Repository audits/hooks require Git.
