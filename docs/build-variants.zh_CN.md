# 公开版与本地个人镜像

只维护一套公开源码；旧私有开发仓库保留为私有历史归档，不需要继续同步开发或删除。
公开仓库包含通用程序、主机配置模板和个人镜像打包工具，不包含作者实际配置、密码、主机名称或地址。
真实配置、镜像、导出和备份只保存在忽略的 `.private/`，提交钩子和历史扫描继续检查。

## 公开 0.5.1

```powershell
.\tools\Build-Firmware.ps1
python tools/check-public-firmware.py .private/build-v0.5.1
```

不读取 `.private/device.config.json`，也不自动使用 `config/device.example.json` 中的示例主机。
不改任何配置也可以编译；**全新 NVS** 启动时主机列表为空，选择 Add server 进行蓝牙添加，
或选择 Add config-file 导入自己的文件。有保存主机后才显示 Server list。
升级若保留 NVS，则保留用户已有主机，不能据此判断公开镜像夹带了配置。
公开镜像版本和程序版本都是 `0.5.1`，清单为 `distribution: public`、`publishable: true`、默认 NVS 全空。

公开模板仍为 `config/device.example.json`（v2）与 `config/bridge.example.json`。
模板只有占位值；运行时导入前需生成真实私有文件，不能直接上传占位模板。
每台主机拥有自己的可选 `wifi: {ssid, password, url}`，最多四台。

## 本地个人镜像

先构建公开版，再从自己的 v2 设备配置生成个人包：

```powershell
.\tools\Build-PersonalFirmware.ps1 -Config .private/device.v2.config.json -Name my-device
```

默认输出 `.private/build-v0.5.1-my-device/MirTar-full.bin`，镜像版本与卡片显示为 `0.5.1-my-device`。
`-Name` 是本地标签，可自行选择；默认值为 `personal`。
两种镜像使用相同的 `0.5.1` 应用程序；个人包另外在 NVS 区域加入实际设备配置和本地标签。
因此 ESP 应用描述符仍为 `0.5.1`，包清单的 `applicationVersion` 与个人镜像 `version` 分别记录两者。
个人清单为 `distribution: personal`、`publishable: false`、`configurationEmbedded: true`，禁止上传。
工具使用 SDK 生成 NVS，再解码核对配置 blob、长度与 CRC；不重新编译密钥进 C/C++ 源码。

**完整刷入个人包会替换 NVS，包含原 Wi-Fi、主机和蓝牙配对记录。** 刷前保留自己的文件；
蓝牙档案在运行时按 `server.id` 生成；完整刷写后，各主机首次连接会建立新的配对。
后续希望保留这些档案时，使用兼容的公开固件分段升级并保留 NVS；配置通过 Add config-file 更新。
个人包不能使用 `-PreserveNvs`，
因为那样不会写入本次预置配置；刷机助手会拒绝这个组合。本文不授权自动刷写设备。
个人包默认从 0x0 完整刷入；通用公开升级可在分区兼容时使用分段刷写保留 NVS。
NVS 未加密，个人包包含可提取的真实凭据，必须只留本机。

## Release 与社区上传

```powershell
python tools/package-release.py --firmware-build .private/build-v0.5.1
```

只允许公开包：检查实际应用版本、分段哈希、空 NVS、发布标记与已知私人数据。
拒绝个人包，即使修改文件名或伪造清单中的 public 标记。打包清单和校验文件只包含经过检查的公开固件。
没有固件时脚本可以仅打包已提交的公开源码／桥接；不能把个人镜像手动补进 Release。

社区投稿使用仓库的保护入口，官方助手和凭据均放仓库外：

```text
python tools/publish-community.py --publisher PATH_TO_OFFICIAL/publisher.py -- submit [官方标题、简介、使用方法、封面及授权参数]
```

该入口只选择已验证的公开 `0.5.1` 固件，自动设置正式社区地址并拒绝外部传入其他 `--firmware`。
首次授权与实际审核状态仍由官方发布助手负责；本次不提交或替换此前待审核版本。
