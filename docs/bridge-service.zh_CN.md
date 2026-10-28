# Windows 后台桥接

0.5.4 可把已有本地桥接安装成当前用户的后台任务。登录 Windows 十秒后自动启动；
无需每天打开 PowerShell。失败后每分钟重试，最多三次；重复启动不会再创建一份实例。
它使用用户桌面会话，以便蓝牙验证码窗口和原生语音浏览器正常工作。
不是 Session 0 系统服务；用户注销或关机后停止，重新登录后启动。

## 安装

先完成本机桥接配置和 Codex 登录，在桥接目录运行：

```powershell
.\tools\Manage-BridgeService.ps1 -Action Install
```

安装会保留现有配置、会话、工作目录、Wi-Fi 和配对。若已有前台桥接，先在原窗口 Ctrl+C 停止。
确认需要迁移当前配置对应的桥接时，可显式使用：

```powershell
.\tools\Manage-BridgeService.ps1 -Action Install -ReplaceExisting
```

迁移仅停止同一用户、同一配置文件的已验证桥接进程树，卡片会短暂断开。
不会停止桌面 Codex、其他项目或占用同端口的无关程序。
安装仅适用于执行命令的这台电脑、当前用户；不会部署到另一台主机。

## 日常管理

```powershell
.\tools\Manage-BridgeService.ps1 -Action Status
.\tools\Manage-BridgeService.ps1 -Action Start
.\tools\Manage-BridgeService.ps1 -Action Stop
.\tools\Manage-BridgeService.ps1 -Action Restart
.\tools\Manage-BridgeService.ps1 -Action Logs
```

已运行时 Start 不会重复启动。Stop 先请求桥接关闭音频、连接和自身后台进程，再退出。
请在任务结束后停止或重启；未完成的语音／回答不自动重放。
Status 的 `BridgeState: running` 表示该实例已报告监听就绪；实际蓝牙连接和原生语音仍需卡片测试。
不要同时再运行 `Start-Bridge.ps1`；需要前台排查时先 Stop，再启动前台脚本。

添加新卡片时先 Stop，按正常流程执行 `Add-Server.ps1`，成功后再 Start，确保桥接重新读取新增绑定。
桌面和桥接同时接管同一 Codex 会话的限制仍然存在，后台运行不提供会话自动交接。

真实日志和状态位于本机 `.private/bridge-service/<配置路径标识>/`。
`bridge.log` 为 UTF-8 合并日志；大于 5 MiB 时在下次启动轮换，保留一份 `.previous`。
初始化失败也可检查同目录的 `launcher-error.log` 和 `launcher-stderr.log`。
这些文件可能有机器地址、路径或会话内容，不要上传。

若微软商店更新移动了已配置的桌面 Codex 程序，后台启动器会定位当前安装版本，
只覆盖该进程使用的程序路径，不改写全局 Codex 配置或本地桥接配置。
自定义 CLI 的失效路径仍需用户修复，不会偷偷改选其他 CLI。

## 其他配置与卸载

所有命令都可传 `-Config 'D:\Private\bridge.config.json'`；同一份配置对应固定任务名。
换路径会成为另一实例；移动项目之前先卸载原位置的任务，再从新位置安装。
需要仅安装、暂不启动时使用 `-Action Install -NoStart`。

```powershell
.\tools\Manage-BridgeService.ps1 -Action Uninstall
```

卸载会停止并删除这个后台任务，保留个人配置、配对、工作文件和日志。
如果 Windows 策略禁止当前用户创建计划任务，安装会报错；旧前台桥接不会在注册失败时被停止。
