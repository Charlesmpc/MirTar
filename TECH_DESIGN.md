# MirTar M1：技术设计与任务

> 版本更新：0.2.0 已记录用户真机验证的 Wi-Fi 语音/回复闭环。
> 0.3.0 新增默认 BLE 路径，见 [技术设计增量与任务](docs/tech-design-0.3.0.md)。
> 下文保留 M1 设计与早期验收记录，不代表 0.3.0 当前实现状态。

- 日期：2026-10-24
- 状态：设计草案；M1-T01 核心闭环已通过，边界与异常仍待验收；产品桥接与固件未实现。
- 已确认范围：**Windows、局域网、Codex 转发；保留适配抽象。**
- 产品行为与硬约束：[DESIGN.md](DESIGN.md)。不另建独立 Spec。

## 1. M1 交付与边界

M1 交付一个 Windows 桥接程序，以及能通过它操作已有 Codex 桌面会话的 AI Passport 固件。允许先用模拟卡片客户端和测试录音验证电脑链路，模拟通过不等于 M1 完成。

必须形成真实闭环：

```text
卡片选择已配置目标和会话
  → 两次 OK 完成录音和提交
  → Windows 桥接
  → Codex 原生语音处理与已有桌面会话
  → 同会话文字/状态返回卡片
  → 可选朗读
```

M1 包括配置注入、目标/会话选择、录音转发、文字阅读、会话切换、返回目标选择、基本错误和重连处理。朗读保持可选，先完成文字闭环，再接简单的 Windows 本地 TTS；若选择原生返回音频，也必须证明它对应目标会话的回复。

M1 不实现 Cursor、其他 Agent、Linux、macOS、公网接入、Tailscale 网关、自动发现、配网界面、云端配置、动态插件系统或卡片审批。不得为满足接口表面完整而生成这些系统的空实现。

## 2. 必须保留的边界

```text
firmware：设备状态、按键、屏幕、音频、Wi-Fi、统一协议
                         ↕
bridge：DeviceTransport → Router → AgentAdapter
                                    └─ CodexAdapter
                         └─ 必要的 Windows HostServices
```

- **DeviceTransport** 只知道 MirTar 协议，不直接调用 Codex。
- **Router** 管理设备连接、当前会话引用、单轮输入和事件分发，不管理 Agent 上下文。
- **AgentAdapter** 提供统一能力、会话、输入和事件语义；Codex 特有协议只出现在 CodexAdapter。
- **HostServices** 隔离真正用到的 Windows 功能。直接音频接口可用时不引入虚拟麦克风；暂时没有平台依赖时，也不强行创建无内容的抽象。
- 四者位于同一个桥接程序内，不额外部署适配器进程或微服务。

后续新增 Agent 应主要增加一个 Adapter；新增 OS 应主要替换实际平台依赖。设备协议和会话引用不因支持第二个 Agent 而改变。

## 3. 技术选择及确认状态

| 项目 | M1 设计选择 | 状态 |
| --- | --- | --- |
| 桥接形态 | Windows 前台/托盘之外的简单常驻命令行程序，读取本地配置；先不开发 GUI、安装器或系统服务 | 实施建议 |
| 桥接语言 | 优先 TypeScript + Node.js 24 LTS，统一异步消息与协议类型；如原生接入依赖其他运行时，由 T01 给出具体依据再调整 | 推荐路线；第三方包版本待实际接入后锁定 |
| 固件基线 | C/C++、ESP-IDF 5.5.6 与 FoloToy AI Passport BSP；5.5.3 保留作上游复现参考；自建界面 | 用户已选定 5.5.6；尚未构建或真机验收，见 3.4 |
| 设备连接 | WebSocket；JSON 控制消息 + 二进制音频帧，一台设备一次只有一轮输入 | M1 协议方向 |
| 地址发现 | 配置文件提供目标地址，不实现 mDNS 或远程设备目录 | M1 简化决定 |
| Codex 接入 | 原生 WebRTC v3 识别 + 原生任务队列 + 正式历史读取；保留桌面会话原写入者 | T01 核心闭环通过，实时状态/边界待补 |
| 音频 | 首个可运行增量采用 16 kHz 单声道 PCM16、20 ms 分帧；桥接缓存后转为原生语音需要的 24 kHz；最多 30 秒 | 真实桥接通过合成录音，卡片采集与局域网上行待真机验证；Opus 后续优化 |
| 存储 | Agent 保存正式会话；桥接仅保留有界内存缓存和单轮状态 | 设计决定 |
| 配置 | 私有 JSON 随固件打包注入；桥接读取本地私有 JSON | 用户已确认 |
| 朗读 | 默认可关闭；一个简单 Windows 本地 TTS 实现即可，不做多引擎框架 | 产品要求及最简实现方向 |

这些是本项目内部的设计选择，不代表某个 Codex API 已提供相应能力。依赖版本、具体命令和上游调用字段在技术验证后记录，不能按候选方案直接宣称可用。

### 3.1 语言与最小依赖

固件和桥接使用不同语言。复用当前 Passport BSP 的固件使用 C/C++；桥接通过协议连接 Codex，语言不受 Codex 自身实现语言限制。Python 用于 ESP-IDF 构建工具和脚本，不要求增加 Python 后端；也不要求编译 Codex 或安装 Rust 工具链。

| 组件 | 开发依赖 | 运行依赖/用途 | 必需性 |
| --- | --- | --- | --- |
| 卡片固件 | ESP-IDF 5.5.6、RISC-V C/C++ 工具链、IDF 管理的 Python 环境、CMake/Ninja | FreeRTOS、BSP、Wi-Fi、音频和 UI 组件，均编入固件 | 必需；Windows 桥接运行时不需要固件工具链 |
| Windows 桥接 | Node.js 24 LTS、TypeScript、`@types/node`、需要时的 `@types/ws` | Node.js 与 `ws`；JSON、文件、子进程和基础缓冲使用标准库 | 推荐的最小路线，尚未创建 package.json |
| CodexAdapter | 与实际安装 Codex 版本匹配的生成协议类型/Schema | 现有 Codex 程序、登录状态及原生语音权限 | 必需；不强制使用 OpenAI SDK |
| 上行 Opus 解码 | 候选 `opus-decoder` | 在 Node 中使用 WASM 解码独立 Opus 帧，再转换为原生输入要求的 PCM/采样率 | 选择 Opus 上行时需要；尚未安装或做本机性能验证 |
| 可选本地 TTS | Windows HostServices 内部调用 Windows PowerShell + `System.Speech` 的最简候选 | 系统已安装的语音；输出音频流/WAV 而非仅在电脑扬声器播放 | 可选；调用属于桥接内部集成，不单独部署 TTS 服务 |

M1 不引入 Electron、数据库、Docker、GPU 推理、ASR 模型或云端语音 SDK。`ws` 的原生加速插件是可选项；首版不启用它们。Opus 解码优先评估 WASM，避免为了一个编解码依赖要求安装 Windows C++ Build Tools。

下行朗读可评估直接发送有界 PCM 帧给卡片，从而先不引入 Node 端 Opus 编码器和 FFmpeg。此路线仍需验证 TTS 输出格式、重采样、局域网吞吐和设备播放，不能作为已打通能力。

### 3.2 固件依赖基线与版本冲突

本地 Passport 基线的 `components/bsp/idf_component.yml` 和 `dependencies.lock` 已确认如下：

| 依赖 | 当前基线锁定版本 | 作用 |
| --- | --- | --- |
| ESP-IDF | 5.5.3 | 芯片 SDK、FreeRTOS 与构建工具链 |
| `lvgl/lvgl` | 9.5.0 | 屏幕界面 |
| `espressif/esp_lvgl_port` | 2.9.0 | LVGL 与 ESP-IDF 集成 |
| `espressif/button` | 4.2.0 | 按键 |
| `espressif/esp_codec_dev` | 1.6.2 | ES8311 等音频设备接口，不等于 Opus 编解码器 |

当前基线还没有应用所需的完整联网音频协议。需补充 WebSocket 客户端与选定的编解码实现，并在构建时锁定兼容版本。

调查到的 `espressif/esp_websocket_client` 1.8.0 manifest 声明 IDF >=5.0；`espressif/esp_audio_codec` 2.6.2 manifest 声明 IDF >=4.4，且文档列出 Opus 编解码。这些声明表明可进入选定的 5.5.6 兼容性验证，不代表已经在 Passport ESP32-C3 上完成构建或性能测试。

2026-10-24 获取的 FoloToy 小智适配仓库 `main/main/idf_component.yml` 要求 **ESP-IDF >=6.0.1**，并声明了多种其他板卡组件。因此 M1 不能直接复制其整套依赖或默认构建环境到 Passport 5.5.3 基线；复用音频逻辑时需单独检查 API、组件版本、内存和实时编码开销。

### 3.3 当前电脑的只读检查结果（2026-10-24）

- Node.js `v24.13.0`、npm `11.14.1`、Python `3.12.10` 与 Codex 程序可用。
- 当前终端没有可用的 `idf.py`、CMake、Ninja，也未设置 `IDF_PATH`；这只说明环境未在当前终端激活，不足以证明整台电脑未安装工具链。检查的常见 ESP-IDF 目录也未发现安装；正式构建前仍需按基线的环境检查流程定位或安装。
- Windows 已有 .NET 6/8 运行时，本次未发现 .NET SDK。推荐桥接路线不要求新增 .NET SDK。
- 已通过 Windows PowerShell 只读枚举到可用的 `Microsoft Huihui Desktop`（zh-CN）和 `Microsoft Zira Desktop`（en-US）。已确认可发现音色，未测试实际合成、流输出或卡片播放。
- MirTar 目前没有 package.json、npm lockfile、Python requirements 或 .NET 项目文件；本文是依赖计划，不是已安装应用清单。本次没有安装依赖、更新工具链或变更系统配置。

语言建议可以先确定为“固件 C/C++ + 桥接 TypeScript”；具体包版本、音频方案及 Windows 原生接入是否需要额外组件，以 T01/T06 的结果为准。

### 3.4 ESP-IDF 版本选择策略（2026-10-24 更新）

5.5.3 是 FoloToy 当前文档、锁文件和验证流程的复现基线，不等于 MirTar 必须永久锁在该补丁版本。上游 BSP 的依赖范围为 `>=5.5.3,<5.6.0`，其中包含 5.5.6；范围允许不代表上游已验证该补丁。

| 版本 | 官方发布日 | MirTar 的定位 |
| --- | --- | --- |
| 5.5.3 | 2026-02-18 | 保留为复现参考；尚未在本项目构建或真机验收 |
| 5.5.6 | 2026-10-16 | 用户已选定的 M1 SDK；兼容性与真机表现待验收 |
| 6.0.3 | 2026-09-02 | 跨主版本升级候选，本次不直接选定 |
| 6.1 | 2026-08-27 | 当前官方最新稳定版本；需独立验证 5.x → 6.x 迁移及实际硬件行为 |

5.5 系列仍处于支持周期，公开支持表列出的 EOL 为 2028-01-21。官方鼓励采用新补丁；5.5.6 发布说明包含 Wi-Fi supplicant 安全修复。用户已确认 M1 使用 5.5.6，不再将它仅列为候选。

暂不直接切到 6.1 的依据：跨 6.x 涉及驱动依赖、接口和加密组件迁移；小智项目 issue #2344 还报告在 Windows、ESP32-C3 和 `folotoy/ai-passport` 上，6.1 发布标签构建的固件出现 Wi-Fi 初始化失败，而 `release/v6.1` 或 6.0.x 可用。截至查阅时该 issue 仍开放；这是具体复现报告，不是 MirTar 自己的测试结论，也不表示全部 6.x 环境都会失败。

T05 应在独立环境完成选定的 5.5.6 的 BSP/组件解析、固件构建及屏幕、按键、Wi-Fi、I2S 录放音和省电验收。构建通过不替代真机测试；若发现兼容问题，记录并处理，不静默切回旧版。需要同步记录组件锁文件和 MirTar 的构建入口；不批量修改或覆盖上游 checkout 的 5.5.3 规则。

本次仅记录选定版本与迁移计划，没有安装 SDK、修改上游依赖、切换实际工具链或刷机。

### 3.5 将来迁移 ESP-IDF 6.0.x 的工作

升级主要影响卡片固件的 SDK、依赖和硬件接口。只要 MirTar 设备协议保持兼容，Windows TypeScript 桥接和 CodexAdapter 通常不需要随 SDK 重写，但仍需端到端回归。

迁移时从当时选定的具体 6.0.x 正式补丁版本开始，单独建立构建环境和迁移分支，保留已验收的 5.5.6 源码、锁文件与本地构建方式。目标是可重复构建，不追随未固定的开发分支。

| 工作 | 对当前参考代码的判断 | 验收方式 |
| --- | --- | --- |
| 工具链、组件约束与构建配置 | BSP manifest 当前限制 `<5.6.0`，直接用 6.0 会被版本约束阻止；需在 MirTar 使用的副本中调整约束，重新解析组件、审查并更新锁文件和配置 | 新环境干净构建，记录工具链版本、配置迁移和组件差异 |
| CMake 驱动依赖 | 当前 BSP 仍声明聚合 `driver`，并使用 SPI、LEDC、GPIO、I2C、I2S。6.0 移除部分隐式依赖，应按实际使用显式声明驱动组件，检查 FreeRTOS 头文件 | 逐项修复构建依赖，不靠关闭诊断掩盖问题 |
| 外设 API | 当前参考代码已经使用 `driver/i2c_master.h`、`driver/i2s_std.h`、`esp_adc/adc_oneshot.h`，避开了多项被移除的旧 API；仍需核对结构体、返回值和休眠/唤醒行为 | 按键、显示、录音、播放、电量、休眠与唤醒逐项真机测试 |
| 音频与联网组件 | 检查 esp_codec_dev、LVGL port、WebSocket、Opus 组件的 6.0 兼容版本；预编译库需确认目标芯片和工具链兼容 | Wi-Fi 重连、音频采样/格式、连续录放、输入/输出切换和内存压力测试 |
| 加密与 TLS（实际使用时） | 6.0 的 Mbed TLS 4/PSA Crypto 迁移影响直接使用旧密码学 API 或 TLS 配置的代码；优先经公共接口和兼容组件处理 | 仅测试项目启用的认证/TLS 路径，确认连接与校验行为 |
| 固件体积、运行资源与配置数据 | 编译通过不能保证堆、栈、实时编码开销和配置读取与旧版相同 | 对比固件大小、可用内存、任务栈、延迟；验证保留布局下的配置读取，不默认擦除 Flash |

应用代码只通过 BSP 和网络/音频模块的公共接口使用硬件，尽量不引入 SDK 私有头文件或寄存器访问。这样可以把未来的迁移修改集中在少数底层模块，不能据此预先保证零修改或估计固定工期。

升级不会自动改变硬件或 MirTar 设备协议，也不代表必须重做所有 UI。实际修改量要在目标版本依赖解析和首次干净构建后才能判断；正式切换以真机和端到端回归通过为准。

## 4. T01：先验证不可替代的 Codex 链路

在开发完整固件前，使用专门的桌面会话及人工准备的测试录音确认：

1. 桥接可以准确引用已有桌面会话，无须依赖当前输入焦点。
2. 音频由 Codex 原生语音能力处理，桥接没有 ASR 实现或额外识别服务。
3. 结束录音后存在明确的提交方式，并可防止提交之前的停顿启动任务。
4. 指令及回复在同一个桌面会话里可见；电脑继续操作后，桥接还能同步该会话。
5. 可以读取该会话的回复与公开状态，不把语音服务自己的会话 ID 当成 Codex 任务 ID。
6. 明确现有登录方式、账号权限、语音额度及是否引入新的费用来源。
7. 能正确退出输入或断开连接，不取消已有 Agent 任务或占用其他会话的语音资源。

官方语音产品文档描述已有 Codex 任务的语音交互，app-server 文档描述任务和流式事件；此前本机协议调查发现实验性的实时音频定义。这些证据提供调查方向，尚未证明第三方桥接可以完成上述组合。

若直接接口不满足，可以评估 Windows 原生音频端点和桌面集成，但同样需要通过上述验收。无法满足时暂停依赖该能力的任务，记录缺口并调整技术设计；不得自动改用独立 API Agent 或桥接 ASR。

T01 产物为 `docs/validation/codex-input-output.md`，记录实际软件版本、调用路径、测试会话来源、行为及结果，剔除凭据和私人会话内容。

2026-10-24 已执行两轮，见 [T01 验证报告](docs/validation/codex-input-output.md)。WebRTC realtime v3 复用现有 ChatGPT 登录，原生识别结果通过 `thread/queue/add` 进入指定桌面会话，原 Agent 实际执行 PowerShell 并返回正式结果；桌面服务继续操作和桥接读回同一上下文通过。直接恢复会话仍被 `already has an active writer` 拒绝，队列路线不需要恢复或接管该会话。直接实时 WebSocket 的 API Key 限制和录音附件路径未识别的结果仍成立。

候选路径为：**录音提交 → 临时 Codex 原生语音前端 → 完整 user 转写 → 原生队列按目标 threadId 投递 → 原桌面 Agent 执行 → 有界正式历史读取。** 临时语音会话只负责单段输入，不承载目标 Agent 的正式上下文；语音前端的 `Received` 等回答不显示或朗读成任务结果。桥接只转发已识别文本，不实现 ASR，也不另建正式会话/队列数据库。

回归发现多句录音有时有未完成的转写句尾；探针加入显式静音尾帧、整体完成等待和未完成拒绝投递，完整录音回归通过。独立进程也曾把尚未写完的历史显示为 `interrupted`，因此冷读状态不能冒充桌面实时忙碌、取消或审批状态。队列接受只代表收到投递，不能显示为任务已经开始或完成；原生语音 ID、队列提交 ID 和工作任务 ID 必须分开。

T01 仍为 IN PROGRESS：需补输入取消/长停顿、实时状态与审批、断线后的提交确认/防重、语音额度和延迟边界。当前约 12.3 秒读到任务完成的测量从队列投递起算，不含录音和识别，不能作为产品端到端延迟。

WebRTC 路线需要媒体引擎。本轮使用临时 Edge 作为验证工具，尚未选定正式桥接媒体依赖；不能据此把原计划中的 `ws` 当作足够的 Codex 音频接入依赖。

## 5. Adapter 的内部契约

下面是 MirTar 自己的语义契约，方法名不等于 Codex 的原生方法。

| 操作 | 输入/输出与责任 |
| --- | --- |
| `getCapabilities` | 返回原生音频、手动提交、桌面同会话、历史、文字增量、音频输出等能力及不可用原因 |
| `listSessions` | 从配置允许的范围返回原生会话引用、标题及状态；标题不作为路由依据 |
| `readSession` | 按能力从 Agent 读取有限的正式消息；不能读时明确声明 |
| `subscribeSession` | 输出目标会话的消息、状态、完成和错误事件，并返回可释放的订阅 |
| `beginInput` | 校验目标会话、就绪状态和音频格式，为单轮输入创建句柄 |
| `appendAudio` | 交付有序音频块；是否已向 Codex 发送由验证过的实现决定 |
| `commitInput` | 结束本轮输入并显式提交；区分收到请求与 Codex 接受输入 |
| `cancelInput` | 丢弃未提交录音并释放资源，不等于取消 Codex 已运行的任务 |
| `dispose` | 释放本 Adapter 拥有的连接、订阅和音频资源 |

M1 不要求通用创建会话、跨 Agent 迁移、任务中断、追加或排队接口；先使用在桌面预建并明确暴露的专用会话。以后有真实需求再扩展契约。

最小数据引用：

```text
SessionRef = target_id + adapter_id + native_session_id
InputRef   = connection_generation + input_id + SessionRef
MessageRef = SessionRef + native_message_id
```

Adapter 可以把原生事件标准化，但不能把不同会话合并成一段聊天，也不能用本地显示缓存构造新的模型上下文。

标准化事件至少区分 `message_delta`、`message_completed`、`input_accepted`、`session_state`、`turn_completed` 和 `error`。同一消息的完成事件更新现有消息，不追加重复全文。

## 6. 录音、提交与缓存

第一次 OK 锁定会话并开始收音，第二次 OK 才允许提交。先验证以下最简路径：

```text
卡片边录边传 → 桥接有界暂存 → 第二次 OK → Codex 原生输入
```

将缓存放在 Windows 内存中，避免卡片保存整段未压缩录音。候选上限为 60 秒，属于待验证默认值；设备或桥接达到上限时停止收音并提示，不自动提交被截断的指令。输入取消、连接断开或超时后释放对应缓存，不把录音写入常规日志。

如果 T01 证明可以在不提前执行的条件下向 Codex 实时推送，则 Adapter 可改为流式上传。卡片按键语义和 Router 不因此改变。

录音队列、帧大小和背压必须有上限。桥接无法接收或关键音频帧缺失时使本轮失败，不能默默丢音后当成完整输入提交。

## 7. 设备协议与路由

### 7.1 会话与控制消息

控制消息包含 `protocol_version`、`type` 和 `request_id`；会话及录音消息还携带对应引用。消息族：

- `hello` / `hello_result`：设备身份、协议版本、认证结果及能力。
- `sessions_list` / `sessions_result`、`session_select` / `session_selected`。
- `input_begin` / `input_ready`、二进制音频帧、`input_commit`、`input_cancel`。
- `input_received`、`input_accepted`、标准化回复与状态事件。
- 可选播放控制及下行音频、心跳和明确错误。

二进制帧需要能关联 `input_id` 或播放流 ID，并有顺序编号。帧头、错误码、超时及消息大小上限在 T02 根据 T01 结果冻结，并提供可供固件和桥接共用的协议样例；音频格式通过能力字段协商，T06 可以根据实测调整编码参数，无须改变控制协议。

JSON 和帧头不得出现 Codex 特有方法名。M1 虽然只有 Codex，仍传递 `adapter_id`；只有一个 Adapter 时界面可以省去额外的 Agent 选择页。

### 7.2 并发与恢复

每个卡片连接一次最多一轮收音。提交时 Agent 忙且不支持明确的追加语义，则返回忙碌，不自行排队或中断。

在录音中禁止切换会话；取消未提交输入后才可返回目标选择。切换阅读会话不会取消已开始的任务，也不能让旧会话事件覆盖新页面。

断线重连创建新的连接代次，恢复授权范围内的原生会话和订阅。已经提交但是否被 Codex 接受不明的输入标记为 `submission_unknown`，不自动重传；网络发送成功不能显示为 Agent 已接受。

## 8. 配置、Windows 与局域网限制

设备配置包含 Wi-Fi、设备 ID、目标列表、地址和连接所需信息。桥接配置包含局域网监听地址、设备允许范围、Codex 接入参数、暴露的原生会话和朗读设置。

M1 不开发账号中心、配对向导或认证管理 UI。可采用配置预置的每设备 token 作为最小应用层校验，具体握手在 T02 明确；它不代替传输加密。

M1 仅在用户指定的可信局域网内测试。若使用明文 WS，必须显式选择该开发模式；不添加公网映射、不做自动穿透。公开服务、WSS 证书管理及远程认证完整方案不属于 M1。

Windows 特有逻辑只能留在对应实现内。需要启动方式、音频端点或本地 TTS 时做最薄的封装；M1 不实现 Linux/macOS 后台服务、权限处理、TTS 或音频驱动。

仓库必须保持私有。真实 Wi-Fi、设备 token、Agent 登录凭据、录音和携带配置的固件都不提交；设计和协议样例使用占位值。M1 尚未实现认证，不能把本文方案当成已有保护。

## 9. 卡片界面与输出

保留产品设计中确定的目标选择、会话选择、两次 OK 录音、上下滚动、长按上下切换会话、长按 OK 返回目标选择。

### 9.1 视觉与皮肤（2026-10-24）

- 保留“随身终端”和“专注阅读”两种候选皮肤，最终默认外观等待真机比较。共用界面状态、内容与按键逻辑，仅替换颜色、字体样式、间距和容器装饰；M1 不增加皮肤商城、下载机制或卡片设置页面，可先由刷入配置选择。
- 卡片非触摸屏，不绘制可点击样式的操作按钮；操作由实体上/下/OK 键完成，底部仅显示紧凑的状态与按键文字提示。原型屏幕外的模拟按键不属于固件屏幕内容。
- 240×320 布局初稿：顶部连接/电量 26 px、Agent/会话行 26 px、正文约 234 px、底部提示及安全留白 34 px。移除大尺寸品牌标题和按钮区域，正文默认按 16 px 中文、约 25 px 行高试排，具体字号与安全边距在真机确认。
- 使用 LVGL 原生组件实现；HTML/CSS 只用于交互预览。两种皮肤共用中文字体资源，避免重复字库；在 T07 记录真机可读性、裁切、刷新耗时、堆内存与固件占用，再决定默认皮肤和最终布局。当前尚未实现或验收固件 UI。

### 9.2 内容与状态输出

M1 目标列表来自刷入配置，至少能区分在线、离线和认证/连接错误。默认只显示允许的 Codex 会话；会话不存在时不能默默新建替代会话。

文字是必要输出，正式历史仍由 Codex 维护。卡片使用有界分页/滚动缓存，用户回看时不自动跳到底部；长内容可通过原生历史能力补取，能力缺失则明确显示范围。

朗读关闭时不产生 TTS；开启时在 Windows 合成或转发经验证的原生音频。开始收音立即停止当前播放；音频故障保留文字路径。正式回复、状态提示和工具日志分别处理，默认只朗读正式回复。

## 10. 任务拆分

2026-10-24 按用户“继续开发并跑通卡片流程”的要求推进首个实现增量。T01 核心链路和 T03 真实桥接通过电脑端合成录音测试；T02 的 v1 协议、绑定与多组 Wi-Fi 配置已实现并记录在 [设备协议](docs/device-protocol.zh_CN.md)。T04 真实测试覆盖一个专用桌面会话，多个会话仍待真实验证；T05–T07 固件源码已编写，构建及真机验收分别记录；T08 暂不实现；T09 已实现基础防重复回执与重连边界，仍需故障注入；T10 等待真实配置、目标网络和卡片。产品模拟、构建和硬件结果不互相替代。

| ID | 任务与产物 | 依赖 | 完成条件 |
| --- | --- | --- | --- |
| M1-T01 | 验证 Windows Codex 原生音频与桌面同会话；记录验证报告 | 无 | 通过第 4 节全部条件；明确输入、回复、认证和额度路线 |
| M1-T02 | 冻结最小 Adapter 契约、设备协议、配置结构与错误语义 | T01 | 字段/帧样例、提交边界、能力声明、版本及缓存上限明确；不包含 Codex 专有设备消息 |
| M1-T03 | 建立桥接核心、配置读取、WebSocket 接入和路由 | T02 | 模拟设备可收发；协议错误与设备身份错误可识别；核心不引用 Codex 原生协议 |
| M1-T04 | 实现 CodexAdapter 与必要的 Windows 集成 | T01、T02、T03 | 通过统一接口操作至少两个预建桌面会话，完成音频提交、同会话回复与订阅释放 |
| M1-T05 | 验收选定的固件 SDK/组件，建立工程、配置注入、Wi-Fi 与目标选择 | T02 | 按 3.4 完成 5.5.6 构建与硬件验收，保留 5.5.3 上游复现依据；真实配置被排除；设备能展示目标并连接桥接 |
| M1-T06 | 完成卡片音频采集、编码、上行与有界缓存/背压 | T03、T05 | 真机录音可在桥接还原；两次 OK、取消、上限和缺帧失败行为正确；记录资源占用 |
| M1-T07 | 完成会话显示、回复增量、滚动与切换 | T04、T05 | 真实 Codex 回复可读；长内容和中文显示可用；切换不串会话且不取消原任务 |
| M1-T08 | 接入可关闭的 Windows 本地 TTS/播放路径 | T04、T06、T07 | 开关和音量生效，收音停止播放，播放故障不影响文字；不引入云端 TTS 费用 |
| M1-T09 | 完成断线、忙碌、未知提交状态和资源回收 | T04、T06、T07 | 重连不会重复执行；迟到事件不覆盖当前会话；重试/切换后无遗留录音或订阅 |
| M1-T10 | Windows + 局域网 + Codex + 真卡片端到端验收与最简运行说明 | T01–T09 | 通过第 11 节，记录真实结果与限制；给出本地构建和运行步骤，不上传私有固件 |

T05/T06 若修改或引用 FoloToy 工程，应按该工程的开发规则、技能、工具链和验证流程执行；本文不代替上游仓库规范，也不授权刷机。

## 11. M1 验收与退出条件

- 在 Windows 上运行一个桥接程序，卡片经局域网完成输入和回复；没有其他 Agent 服务或新增 ASR。
- 使用真实 Codex 桌面会话，卡片和桌面可以继续同一会话，至少两个会话路由正确。
- 第二次 OK 前不执行输入；取消录音不启动任务；朗读与录音互斥。
- 上下滚动、长按切换会话和返回目标选择符合产品设计。
- 正式回复只显示一次；忙碌、等待审批、错误和未知提交状态不伪装成成功。
- 测试断网、重连、目标不可达、错误身份、录音上限、长回复以及连续多轮操作。
- 分别记录录音结束到接受、接受到首段文字、文字到首段声音的时间与真机内存表现；不预先承诺未经测量的速度或续航。
- 私有配置与固件未被跟踪，仓库保持私有；Windows 以外和局域网以外均不计入已支持能力。

验证报告分列：桥接构建、协议/路由测试、真实 Codex 集成、固件构建、真机测试、未验证项。只有模拟设备或文本转发通过时，不能宣布 M1 语音闭环完成。

## 12. 当前下一步

ESP-IDF 5.5.6 / LVGL 9.5.0 占位配置固件已完成构建、链接、完整镜像与各段核对；正式桥接通过真实 Codex 语音和输入/完成关联测试，见 [首个实现验证](docs/validation/m1-first-loop.zh_CN.md)。下一步使用用户本地填写的 `wifiNetworks` 数组和电脑配置生成实际联调固件。用户当前不在目标 Wi-Fi 环境，本轮不以占位构建或模拟设备替代真实联网、绑定、录音和屏幕验收。优先验收卡片语音 → Codex 桌面原会话 → 卡片文字回复，TTS 保持关闭。

任务状态以 [T01 验证报告](docs/validation/codex-input-output.md) 和实际验收为准；文档或探针存在不代表 M1 已实现。

## 13. 参考

- [产品设计与已确认交互](DESIGN.md)
- [OpenAI Docs：Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [OpenAI Docs：已有 Codex 任务的语音](https://learn.chatgpt.com/docs/features/voice)
- [FoloToy AI Passport 基线](https://github.com/FoloToy/ai-passport)
- [Passport 小智适配版](https://github.com/FoloToy/folo-ai-passport-xiaozhi)
- [Passport BSP 依赖声明](https://github.com/FoloToy/ai-passport/blob/main/components/bsp/idf_component.yml)
- [小智适配版依赖声明](https://github.com/FoloToy/folo-ai-passport-xiaozhi/blob/main/main/idf_component.yml)
- [Node.js 发布与 LTS 状态](https://nodejs.org/en/about/previous-releases)
- [ws：WebSocket 与可选原生加速依赖](https://github.com/websockets/ws)
- [opus-decoder：Node/浏览器 WASM Opus 解码](https://github.com/eshaz/wasm-audio-decoders/tree/main/src/opus-decoder)
- [Windows SpeechSynthesizer：系统音色与音频流输出](https://learn.microsoft.com/en-us/dotnet/api/system.speech.synthesis.speechsynthesizer)
- [ESP-IDF 5.5.6 正式补丁与发布说明](https://github.com/espressif/esp-idf/releases/tag/v5.5.6)
- [ESP-IDF 版本与支持策略](https://docs.espressif.com/projects/esp-idf/en/stable/esp32c3/versions.html)
- [ESP-IDF 支持版本及 EOL 表](https://docs.espressif.com/projects/idf-build-apps/en/latest/others/CONTRIBUTING.html)
- [5.5 → 6.0 的外设迁移说明](https://docs.espressif.com/projects/esp-idf/en/stable/esp32c3/migration-guides/release-6.x/6.0/peripherals.html)
- [小智 #2344：Passport ESP32-C3 的 6.1 标签 Wi-Fi 初始化失败报告](https://github.com/78/xiaozhi-esp32/issues/2344)
- [ESP-IDF 6.0：外设迁移](https://docs.espressif.com/projects/esp-idf/en/v6.0/esp32c3/migration-guides/release-6.x/6.0/peripherals.html)
- [ESP-IDF 6.0：构建系统迁移](https://docs.espressif.com/projects/esp-idf/en/v6.0/esp32c3/migration-guides/release-6.x/6.0/build-system.html)
- [ESP-IDF 6.0：加密与 TLS 迁移](https://docs.espressif.com/projects/esp-idf/en/v6.0/esp32c3/migration-guides/release-6.x/6.0/security.html)

官方页面于 2026-10-24 查阅；实际接入以 T01 记录的本机版本、账号和端到端结果为准。
