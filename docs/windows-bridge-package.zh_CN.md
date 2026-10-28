# Windows 桥接包使用说明（0.5.4）

[English](windows-bridge-package.md)

桥接包包含运行源码、启动／后台管理助手与配置模板，不含个人配置、Node.js、Codex 或 Edge。
固件在 Release 中单独提供；编译固件需完整源码包。

## 首次使用

1. 准备支持蓝牙的 Windows、PowerShell 5.1 或 7、Node.js 24.13+、Edge，安装并登录 Codex 桌面应用。
2. 解压到可写目录，在 `MirTar-windows-bridge` 中运行：

   ```powershell
   npm.cmd ci --ignore-scripts
   .\tools\New-LocalConfig.ps1 -BluetoothOnly -BridgeOwned
   ```

   设置工具优先使用桌面应用自带的 Codex 后台，不要求先创建桌面会话。已有配置不要重复初始化。
   需要已有项目目录时，给第二条命令加 `-WorkingDirectory 'D:\Projects\MyProject'`，目录需存在且可写。
3. 卡片选 Add server，电脑运行 ` .\tools\Add-Server.ps1 `。输入显示名称或直接回车；
   在 Windows 输入卡片六位码，再在卡片 OK 确认。看到“添加成功”后返回首页。
4. 在电脑安装并启动后台桥接：

   ```powershell
   .\tools\Manage-BridgeService.ps1 -Action Install
   ```

   默认工作区为当前用户目录下的 `MirTar/workspaces/default`。首次启动创建 MirTar Agent 会话并保存路径；
   以后登录自动启动。卡片选 Server list → 主机 → Bluetooth → MirTar Agent，看到就绪后即可录音。
5. OK 开始录音，再按 OK 发送；上下翻阅，长按上下切会话，长按 OK 回首页。
   专用会话追问时 OK 打开回答菜单，可语音回答或选择选项。

## 已有配置与后台管理

真实配置只保存在本机 `.private/bridge.config.json`。当前配置中的会话和绑定会保留。
旧配置若只有桌面转发会话，先停止桥接，再运行 `New-AgentSession.ps1` 添加新的桥接驱动会话；
见[卡片问答与工作目录](agent-questions.zh_CN.md)。不要只给旧桌面会话 ID 改一个模式标记。

```powershell
.\tools\Manage-BridgeService.ps1 -Action Status
.\tools\Manage-BridgeService.ps1 -Action Stop
.\tools\Manage-BridgeService.ps1 -Action Start
.\tools\Manage-BridgeService.ps1 -Action Restart
.\tools\Manage-BridgeService.ps1 -Action Logs
```

后台任务在“任务计划程序库”中，名称由 Status 显示；旧安装看不到任务时可开启“查看 → 显示隐藏任务”。
同一配置只运行一份；前台排查需先 Stop，再运行 `Start-Bridge.ps1`。
Add server 后重启桥接以读取新增绑定。服务日志与状态均在忽略的 `.private/bridge-service/`。

旧桌面转发模式仍依赖桌面激活；桥接驱动模式直接执行。桌面和桥接不能同时接管同一个会话；
切换客户端前结束任务并停止当前端。暂不支持卡片执行权限审批或收集秘密输入，也未实现回复朗读。

## 可选局域网与升级

蓝牙不需要给卡片配网，Codex 自身仍需联网。可选 Wi-Fi 通过主机配置文件导入，入口、热点和上传步骤
见[主机添加说明](server-onboarding.zh_CN.md)。Wi-Fi 仅用于可信局域网，默认端口为 TCP 28743，
桥接监听、卡片地址和防火墙端口需一致。

既有卡片建议使用公版 `MirTar.bin` 在 `0x10000` 更新应用，保留配置和配对。
`MirTar-full.bin` 从 `0x0` 写入，完整刷入可能清除配置与配对；社区刷机使用公版完整镜像。
所有公版产物不含作者的 Wi-Fi、主机绑定或会话。个人镜像仅供本地使用，禁止上传。

BLE 助手由 Windows 自带 .NET Framework 编译器本机编译，不需要额外 .NET SDK 或预编译原生程序。
完整开发检查需安装开发依赖；本包不是独立 Git 仓库。详见[后台服务](bridge-service.zh_CN.md)和
[验证记录](validation/agent-questions-0.5.4.md)。
