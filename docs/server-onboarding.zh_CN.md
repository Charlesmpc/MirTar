# 主机添加与配置导入（开发版）

本分支从 v0.3.1 重新开发，版本标识为 `0.5.1`。保留专注阅读皮肤与 Codex 语音链路。
v0.5.1 公版已于 2026-10-25 提交社区审核（项目 1619，版本记录 3705），回执为待审核。
主机检查和编译不代表新增流程已经真机通过。

## 卡片首页

开机最多显示三个并列入口；没有主机时只显示两个添加入口：

1. **Server list**：有保存主机时显示。选主机后默认 Bluetooth，可手动选该主机的 Wi-Fi。
2. **Add server**：只通过蓝牙添加，不列出附近电脑、不使用 Wi-Fi。
3. **Add config-file**：主动开启卡片热点，上传准备好的设备配置。不会因连接失败自动打开。

长按 OK 取消当前操作并回首页。添加或导入成功后也回首页，再从 Server list 连接。

## Add server：蓝牙添加

电脑需要 Windows、BLE、Node.js 24.13+、Edge、已登录的 Codex 桌面应用及专用会话。
在仓库先运行 `npm.cmd ci --ignore-scripts`。没有私有配置时，运行
`.\tools\New-LocalConfig.ps1 -BluetoothOnly`，根据提示填写现有会话 ID；已有配置不会覆盖。

1. 卡片选择 **Add server**，进入约两分钟的添加窗口。
2. 在目标电脑运行 `.\tools\Add-Server.ps1`。主机显示名称默认使用电脑名，也可输入自定义名称；
   可直接指定 `.\tools\Add-Server.ps1 -Name 'Work laptop'`。
3. Windows 弹窗中输入卡片的六位配对码。电脑内部发现处于添加模式的卡片，卡片不扫描或显示电脑列表。
4. 卡片显示收到的主机名称，**按 OK 确认保存**，长按 OK 取消。
5. 结束添加工具，重启普通桥接 `.\tools\Start-Bridge.ps1`，卡片在 Server list 选择该电脑和 Bluetooth。

添加工具只负责配对，不初始化 Agent、不发送语音、不执行会话任务。电脑先保存随机绑定密钥，再发送给卡片；
取消或回执丢失时可能留有未使用的电脑端设备记录，保留供重试，不自动删配对或旋转密钥。
卡片持久化后才报告成功。首次连接完成加密认证，日常连接仍走原有应用绑定校验。
同一稳定主机 ID 可更新名称，蓝牙名称是连接标识，不必与显示名称相同。满四台时通过文件更新已有条目。
现有普通桥接如已运行，完成后重启以加载新绑定信息；不用终止正在执行的 Codex 任务。

## 蓝牙断线超过一分钟：重置当前主机配对

通过 Bluetooth 连接已保存主机，累计一分钟仍未完成绑定时，屏幕增加“重置蓝牙配对”。
按 OK 打开确认页，上下选择重置，再按 OK；默认选中取消，反复断线不会重启计时。

重置只作用于当前 `server.id` 的蓝牙记录和卡片蓝牙身份，保留其他主机的配对、主机列表、
应用绑定密钥与 Wi-Fi。成功后按 OK 连接，在 Windows 输入新验证码；电脑桥接保持运行。
新身份让 Windows 建立这台主机的新配对，普通重置无需手动填写地址或清理其他主机。

每台主机的二进制蓝牙档案由程序自动维护，不属于需手工编辑的 config-file。
Add server 中生成的配对，在卡片确认后自动归入对应 `server.id`；改显示名称或 Wi-Fi 不影响它。
旧版共享蓝牙存储保留且不自动分配给任何主机；升级后各主机首次连接需要重新输入验证码。
详见[蓝牙存储设计](bluetooth-storage.md)。

长按 OK 可退出；到期本身不会清除配对或重放录音，失败会明确提示。
Wi-Fi、Add server 和配置上传页不出现此入口。`Start-Bridge.ps1 -ResetBluetoothPairing`
仅作为 Windows 旧配对的显式维护工具，不是新流程必需步骤。

## Add config-file：通过卡片热点上传

1. 准备下面的 **version 2** 设备 JSON。必须是实际配置，去掉公开模板中的 `template: true`。
2. 卡片选择 **Add config-file**。手机扫码，或手机／电脑手动连接屏幕所示的 `MirTar-Setup-XXXXXX`，
   密码见屏幕。提示没有互联网时保持连接。
3. 浏览器打开 **http://192.168.4.1**，选择设备配置文件，点击“上传并保存配置”。
4. 等待“配置已保存”，卡片关闭热点并回首页；手机／电脑切回正常网络后，启动桥接并从 Server list 连接。

失败可重新上传；长按 OK 退出。网页只上传文件，不搜索网络或电脑，不单独填写 Wi-Fi，不访问厂商云端。
热点地址固定，不保证手机自动弹出配网页。手机需事先拥有该文件，也可直接使用电脑上传。
网页显示这张卡片的 deviceId，已保存主机时文件 deviceId 必须相同，不能覆盖成另一张卡片身份。
空卡首次导入允许采用文件指定的 deviceId。

## version 2：以主机为单位

公开模板见 [device.example.json](../config/device.example.json)。真实文件放在忽略的 `.private/`。

```text
deviceId
servers[]
  id                 固定主机 ID；改显示名称时保持不变
  name               卡片显示名称
  bluetoothName      与电脑 bridge.bluetooth.hostName 一致
  secret             与电脑授权该 deviceId 的密钥一致
  wifi（可选）
    ssid
    password
    url              该主机的 ws://LAN_IP:28743/device
```

每台主机拥有自己的 Wi-Fi，最多四台。只用蓝牙时省略 `wifi` 或设为 `null`。
导入按 `id` 新增或更新，保留其他主机；同一 ID 的整项配置被文件替换。
不同主机不能使用相同蓝牙连接名称。文件不超过 4096 字节；名称最多 40 个 UTF-8 字节。
Wi-Fi 仅 2.4 GHz，SSID 最多 32 字节；开放网络密码为空，否则 8–63 字节。
选择某主机的 Wi-Fi 时，只使用其 SSID、密码和电脑地址，不尝试其他主机的网络。
约 30 秒未联网只显示失败，不自动启动热点；电脑不可达也不会触发配网。
Wi-Fi 电脑需在可信专用网络放行所配置的 TCP 端口，默认 28743。蓝牙无需开放 LAN 端口。

新建带 Wi-Fi 的文件，可运行 `New-LocalConfig.ps1` 并填写电脑 LAN 地址、网络名称与密码；
`-Name`、`-ServerId`、`-DeviceId` 可显式指定。只配置电脑地址、稍后编辑 JSON，可使用 `-NoWiFiPrompt`。
`-AddWiFi -ServerId ID` 更新指定主机的一组 Wi-Fi。修改地址／密码后重新上传即可，无需重新编译。
蓝牙添加后，已有桥接中的实际绑定信息可通过 `Export-DeviceConfig.ps1 -DeviceId 卡片ID` 导出，
加 `-WiFi -BridgeAddress 电脑局域网IP` 时再填写该主机的网络。默认输出 `.private/device.export.config.json`，
不覆盖已有文件；不加 `-WiFi` 的导出表示该主机仅用蓝牙，重新导入会清除该主机原有 Wi-Fi 项。

旧 version 1 文件不能直接导入，避免将全局网络错误地分配给主机。运行：

```powershell
.\tools\Convert-DeviceConfig.ps1
```

默认生成 `.private/device.v2.config.json`，不改原文件。只有一组旧网络时将其分别归入每台主机；
多组时必须显式用 `-ServerWiFiIndex @{ WorkLaptop=0; HomeLaptop=1 }` 指定零起始索引，不猜测对应关系。
从 v0.3.1 升级，编译内置配置不会自动迁移；旧 v0.4.0 NVS 格式也不会直接读取，不自动擦除。

## 验证、构建与使用

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run test:portal
# 构建助手需 PowerShell 7；配置／添加工具支持 Windows PowerShell 5.1：
.\tools\Build-Firmware.ps1
# 仅预览，不接触设备：
.\tools\Flash-Firmware.ps1 -Port COMx -PreserveNvs -WhatIf
```

默认固件在 `.private/build-v0.5.1/MirTar-full.bin`，完整镜像从 **0x0** 刷入。
原分区兼容时用 `-PreserveNvs` 分段刷写；完整镜像会影响已有配置，刷前保留旧文件和已验证固件。
未经用户明确授权，不自动刷机。公开构建不读取实际配置；个人预置请使用独立的
`Build-PersonalFirmware.ps1`，见[构建与发布隔离](build-variants.zh_CN.md)。公开构建的 `-Config` 参数禁用。

连接后，OK 开始录音，再按 OK 发送；上下翻阅回复，长按上下切会话，长按 OK 回首页。
原生会话和 ASR 仍由 Codex 提供。TTS、Cursor、其他 OS、OTA 不在本次实现中。
NVS 尚未加密；业务 Wi-Fi 为可信局域网明文，真实配置、备份、录音和日志不能上传 Git 或社区。
真机待验收：新首页按键、蓝牙添加／取消／重连、确认后保存、热点扫码／文件上传、重启保留、
所选主机的网络隔离及原有语音回复链路。主机模拟测试不能替代这些验收。
