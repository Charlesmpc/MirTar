# M1-T01：Windows Codex 输入输出依赖验证

- 日期：2026-10-24，Asia/Hong_Kong。
- 状态：**核心闭环已通过；T01 仍为 IN PROGRESS，输入边界、实时状态、异常与额度边界待补。**
- 范围：本机 Codex、现有 ChatGPT 登录、专用桌面测试会话和临时协议会话。没有卡片、固件或完整桥接验收。

## 1. 结论

**已验证：原生录音识别 → 官方队列 → 指定桌面会话 → 本地命令执行 → 同会话正式回复。**

在本机独立启动的 Codex app-server 中，使用现有 ChatGPT 登录，通过 **WebRTC + realtime v3 + audio 输出模式**，成功发送 8.2145 秒合成录音。原生语音服务返回完整的用户识别文本，并以 `assistant` 角色回复 `cobalt seven`。没有向模型提供该口令的文字输入，没有部署或调用桥接 ASR，也没有提供新的 API Key。

首轮测试中，另一个 app-server 恢复桌面会话被 `already has an active writer` 拒绝。后续找到官方队列入口：无需恢复或接管目标会话，就能把已完成的原生用户转写通过 `thread/queue/add` 投递给桌面持有的同一个 Agent。它实际执行了 PowerShell `731 * 947`，退出码 0、输出 `692257`，并在原来的「MirTar 验证」会话回复 `692257 completed`。

桌面服务入口随后设置了一个仅存在于该会话的测试标签；桥接只询问标签，没有再次提供标签内容，正确读回 `BRIDGE-STATE:mirtar-desktop-4826`。同一会话的上下文由原 Agent 维护，桥接没有重新拼装历史或建立替代工作会话。

当前候选是 **Codex 原生语音前端 + 原生任务队列 + 有界历史读取**。临时原生语音会话只处理单轮音频，只有 `user` 角色的完整识别结果进入指定桌面任务；语音前端自己的 `Received` 不作为任务回复。不能强行释放写入锁，也不能把语音前端当成真正执行工作的 Codex 会话。

## 2. 实际环境与测试材料

| 项目 | 实测值 |
| --- | --- |
| Windows | 10.0.26200，x86_64 |
| Codex 桌面包 | 26.1016.6573.0 |
| Codex CLI / app-server | 0.163.0-alpha.11，桌面自带程序 |
| Node.js | v24.13.0 |
| 登录 | `codex login status` 和 `account/read` 均确认 ChatGPT 登录；未读取或输出认证令牌 |
| WebRTC 测试引擎 | Microsoft Edge 154.0.4258.37，独立无头进程和临时 profile；未使用用户浏览器资料或麦克风 |
| 测试录音 | Windows `System.Speech` / Zira 离线合成，WAV PCM16，24 kHz，单声道，394,342 字节 |
| 时长 | 197,148 帧，8.2145 秒 |
| WAV SHA-256 | `d13cfb4988585470cecf0ef76516f577929a659aec81eec4f99d23a2591fd114` |
| 新增 npm 包 | 无；探针使用 Node 标准库和本机浏览器 |

录音内容为：`This is a MirTar input test. Please reply only with the words cobalt seven. Do not use any tools.`

用户授权新建「MirTar 验证」桌面会话并发送合成测试语音。桌面会话先仅回复 `READY`；首轮外部恢复被拒绝，随后独立验证语音协议。用户要求继续后，复用同一专用桌面会话验证队列、语音到本地命令、桌面服务继续操作及桥接读回。没有给其他工作会话发送测试内容。

Schema、探针输出、合成录音及浏览器临时资料均在被 Git 忽略的 `.private/` 下；不提交这些文件。报告只保留版本、合成文本、错误和结果，不包含私人聊天内容、Wi-Fi 配置或凭据。

## 3. 已执行的检查

3.1–3.5 保留首轮结果；3.6 记录后续找到的队列路线及实际闭环。直接恢复会话失败，并不代表官方队列不可用。

### 3.1 登录、历史与运行时

| 检查 | 结果 | 实际含义 |
| --- | --- | --- |
| `initialize` / `initialized`，开启 `experimentalApi` | 通过 | 可以用 Node JSONL 客户端连接本机 Codex 协议 |
| `account/read`，不主动刷新 Token | 通过 | 可复用现有 ChatGPT 登录；不证明所有语音入口都支持该认证 |
| `thread/read`，按当前桌面会话 ID，`includeTurns: false` | 通过 | 精确命中已存在的会话，但独立进程返回 `notLoaded` |
| `thread/items/list`，最近 10 项，仅输出条目类型 | 通过 | 读到 `userMessage`、`agentMessage` 等正式历史；没有打印或保存正文 |
| 独立进程的 `thread/loaded/list` | 返回 0 项 | 该进程没有桌面的活动会话；不能据此判断桌面无任务 |
| 默认 `codex app-server daemon version` / `proxy` | 失败 | 默认控制 socket 不存在，连接返回 Windows socket 错误 10050；沙箱外复核仍失败 |
| 桌面 Codex 进程连接方式 | 已定位 | 本次桌面使用自身启动的 app-server；未发现可用的默认 daemon 控制入口 |
| 恢复空闲桌面测试会话 `thread/resume` | 失败 | 返回 `already has an active writer`；桌面空闲不代表其已放弃写入所有权 |

首轮没有重启或停止桌面、启动共享 daemon、开启远程控制、修改全局代理/认证配置，或删除锁文件；当时专用会话只有 `READY`。后续测试通过正常队列向同一会话追加了验证轮次，没有改变其写入者所有权。

### 3.2 模型与语音能力声明

- 本机生成的实验协议包含 `turn/start` 的 `audio`、`localAudio`，以及 `thread/realtime/start`、`appendAudio`、`stop`、SDP 和转写事件。
- `model/list` 包含隐藏模型、无下一页，共返回 9 项；本次所有项均仅声明 `text`、`image` 输入，没有 `audio`。
- `experimentalFeature/list` 完整分页读取 176 项；`in_app_voice`、`realtime_conversation` 均为启用。
- `thread/realtime/listVoices` 正常返回。上游实现返回的是内置音色列表，不能用此调用证明账号认证或媒体连接已成功。

协议支持一种数据类型、功能开关为真、正常返回音色列表，均不能代替实际音频测试。

### 3.3 录音附件路径：未通过

调用路径：

```text
独立 app-server → thread/start(ephemeral)
  → turn/start(input: [{ type: localAudio, path: synthetic WAV }])
  → 文字增量与 turn/completed
```

使用该进程默认的 `gpt-6.1-sol`。`turn/start` 在本次测试中约 75 ms 返回接受，随后任务正常完成，但助手明确表示无法听取音频，没有返回录音口令。

这只证明协议提交、任务和文字回复路径可运行，**没有证明模型处理了录音**。公开上游源码也区分录音附件与原生实时语音：`LocalAudio` 转为音频 data URI；不支持音频的模型会经过剥离不支持媒体的逻辑。公开源码版本不等于本机二进制的精确构建源码，实际否定结果以本机测试为准。

### 3.4 实时 WebSocket：当前登录未通过

临时会话调用 `thread/realtime/start`，`transport: websocket`。JSON-RPC 接受请求后，异步返回：

```text
realtime conversation requires API key auth
```

没有发送音频帧，随后调用 `thread/realtime/stop` 并结束自有子进程。**这个限制属于此次直接 WebSocket 路径，不能扩大为所有 Codex 语音均需要 API Key。**

### 3.5 WebRTC v3：独立原生语音通过

测试通过 Node 的回环 HTTP 服务和临时 Edge 媒体引擎生成真实 SDP offer，将其交给 Codex；服务只绑定 `127.0.0.1`，不暴露局域网入口。SDP 和媒体凭据没有写入报告或普通日志。

首先确认了两个版本/参数限制：

1. WebRTC 默认使用 realtime v1，`text` 输出被拒绝：`text realtime output modality requires realtime v2`。
2. v1 改为 `audio` 输出后，服务端要求 `OpenAI-Alpha: quicksilver=v2`。上游实现由 realtime v3 选择对应协议头，因此通过受支持的 `version: v3` 参数重试，没有手工伪造认证头。

成功参数与数据路径：

```text
thread/start(ephemeral: true)
  → thread/realtime/start(
      version: v3,
      outputModality: audio,
      transport: { type: webrtc, sdp: offer }
    )
  → thread/realtime/sdp → WebRTC connected
  → 测试提交点 → 浏览器发送预先完整缓存的 WAV 音频
  → thread/realtime/transcript/delta、transcript/done
  → thread/realtime/stop → 退出自有浏览器和 app-server 进程
```

最终复核明确区分角色：

| 角色 | 原生 `transcript/done` 内容 |
| --- | --- |
| `user` | `This is a MirTar input test. Please reply only with the words cobalt seven. Do not use any tools` |
| `assistant` | `cobalt seven` |

预期口令只从音频输入模型；探针没有提交其文字副本。测试期间未使用 ASR 库/服务、麦克风或新的 API Key。音频输出保持协议要求的 `audio` 模式，但未连接电脑扬声器，未验证听感、音频回传或卡片播放。

退出复核发现只结束 Edge 主进程会残留测试子进程。已按本仓库 `.private/codex-validation/rtc-profile-<UUID>` 的精确路径清理全部 4 个测试 profile 对应的进程，复核剩余测试浏览器进程为 0；未结束个人浏览器或已有 Codex 进程。探针加入同样的路径校验清理脚本。测试 profile 文件继续留在忽略目录，没有递归删除用户目录。

**此成功仅证明原生语音识别和语音助手回复，不证明已触发目标 Codex Agent 的工作轮次。** 实时服务自身的 `turn.created` / `turn.done` 不能当成 Codex 的 `turn/started` / `turn/completed`。本次成功记录没有证明 backing Agent 执行或桌面历史同步。

### 3.6 官方队列与桌面同会话：核心闭环通过

先用官方 `codex queue --thread <native ID> --message <测试文本>`，让原来的桌面会话回复 `QUEUE-CHECK-271`。随后在同一个独立协议进程中直接调用 `thread/queue/add`，确认无需对目标会话调用 `thread/resume`。

最终通过的链路为：

```text
完整缓存的合成录音 → 测试提交点
  → Codex WebRTC v3 原生识别（临时原生语音会话）
  → 显式静音尾帧 + 等待所有用户转写片段完成
  → 关闭本次语音连接；未完成或缺少测试约束则拒绝投递
  → thread/queue/add(原桌面 threadId, user 转写文本)
  → 原来的桌面 Agent 消费队列并执行本地命令
  → thread/turns/list / thread/items/list 读取正式任务结果
```

这段桥接没有 ASR 模型或识别服务，只转发 Codex 原生语音给出的用户文本。没有把原生语音助手的回答、语音会话 ID 或队列提交 ID 当成工作任务结果/ID。目标桌面会话的上下文没有复制到语音前端。

第二段 WAV 为 24 kHz 单声道 PCM16，646,342 字节、323,148 帧、13.4645 秒。SHA-256 为 `199e5f3a554faa4f418c07a92fbaf3097ba18b84bc2378b985669bad3d0c952c`。其内容要求实际运行本地 PowerShell 计算 731 × 947，不修改文件，并以数值和 `completed` 回复。

最终回归记录：

| 检查 | 结果 |
| --- | --- |
| 原生用户转写 | 完整保留计算请求、`Do not change any files` 和末尾 `word completed` |
| 语音前端行为 | 仅回复 `Received`；未观察到它启动自己的 Codex 工作轮次 |
| `thread/queue/add` | 约 4 ms 返回队列接受，回显的 `clientUserMessageId` 匹配 |
| 原桌面任务轮次 | `01a16cda-bce1-7d02-a86b-8f16ca42fb7a`，正式历史确认 `completed` |
| 真实本地命令 | PowerShell `731 * 947`，退出码 0，标准输出 `692257` |
| 正式 Agent 回复 | `692257 completed`，同一个「MirTar 验证」会话 |
| 桌面服务继续操作 | 原会话正确回复 `DESKTOP-CONTINUE:692257`，随后设置会话测试标签 |
| 桥接继续操作 | 未重新提供标签内容，原会话正确回复 `BRIDGE-STATE:mirtar-desktop-4826` |
| 读回来源 | 独立 app-server 的正式持久化历史，与桌面 `read_thread` 互相核对 |

桌面继续操作通过桌面服务入口完成；没有自动点击窗口或模拟手动键盘输入。语音内容和回复已进入桌面可读取的同一会话，手动 UI 输入仍需产品阶段验收。

回归过程中修复了两个实测问题：

1. **冷读状态不能冒充桌面实时状态。** 独立进程曾在桌面仍执行时把尚未写完的轮次显示为 `interrupted`，桌面随后正常完成。探针改为等待确认的正式完成记录；不能把这种快照当作 Agent 已取消、失败或空闲。
2. **多句录音必须保留句尾约束。** 只收集已经 `done` 的第一段会漏掉仍在增量中的后半句。一次回归因此只投递了计算请求，遗漏回复格式要求。已加入未完成尾段检查、显式静音采样和整体完成等待；未完成版本实测被拒绝投递，补上静音尾帧后的完整录音通过。只等待固定秒数不能替代完成判断；这次通过也不能代替长停顿、不同录音及异常场景的测试。

本次约 8.226 秒后首次在历史中观察到新轮次，约 12.332 秒后读到正式完成结果，均从队列投递计时，包含 1 秒历史读取间隔。**这些数字不包含录音重放、原生识别和连接建立，不能当作录音结束到回复的产品延迟。** 固定上游源码的原生队列服务含 10 秒跨进程轮询，可能解释部分等待；没有证明本机所有情形都有固定延迟。

完成队列测试后，原桌面会话仍可继续；测试浏览器进程复核为 0。本次没有打开局域网监听、真实卡片、完整桥接或固件。

## 4. 对照 T01 验收

| 技术设计第 4 节条件 | 状态 | 依据与缺口 |
| --- | --- | --- |
| 准确引用已有桌面会话，输入不依赖焦点 | 核心通过 | 按原 threadId 队列投递并执行，无需接管写入锁或输入焦点 |
| Codex 原生处理音频，桥接无 ASR | 核心通过 | 原生用户识别文本经队列进入原桌面 Agent，并实际执行本地命令 |
| 第二次 OK 明确提交，停顿不提前执行 | 部分验证 | 测试提交前不交付录音；完成后才入队，未完成句尾被拒绝；真实按键、长停顿和取消仍待测 |
| 指令/回复在同一桌面会话，桌面继续后可同步 | 服务级通过 | 同一桌面 Agent 执行，桌面服务设置上下文后桥接正确读回；手动 UI 操作仍待测 |
| 读取正式回复与公开状态，区分各类 ID | 回复通过，实时状态未齐 | 正式命令、退出码和回复读回成功；冷读快照不能可靠表示忙碌/中断/等待审批 |
| 登录、权限、额度和费用路线明确 | 部分通过 | WebRTC v3 复用 ChatGPT 登录；未确定原生语音额度、全部权限/发布条件及计费细节 |
| 退出/断开不影响其他任务 | 正常退出初步通过 | 观察到本次语音 `closed`，原桌面任务正常执行且可继续；异常退出和独占资源边界仍待验证 |

没有新增 API Key 或独立 ASR 服务，不等于语音不消耗原生账号额度。浏览器收到语音会话的 usage 事件，本报告没有据此推导可用时长或价格。

## 5. 依赖与设计影响

- **继续保留 TypeScript + Node.js 方向。** 本次协议客户端不需要 OpenAI SDK、Python ASR、GPU 或额外模型。
- 现有 ChatGPT 登录下，**直接实时 WebSocket 不能作为已验证路线**。应优先研究 WebRTC v3 与桌面实际运行时的组合。
- 已找到的组合是 WebRTC v3 原生识别、官方 `thread/queue/add`、原会话持久化历史读取。队列由 Codex 维护；桥接不另建 Agent 队列数据库或正式会话上下文。
- WebRTC 需要媒体/DTLS/SRTP 引擎。本次复用临时 Edge 只是探针，不代表 M1 交付必须启动无头浏览器；是否复用桌面原生媒体端点或增加其他组件，待运行时入口确认后再决定和锁定依赖。
- 第二次 OK 前在桥接完整缓存音频仍是合理候选；实际原生语音对停顿、指令拆分和 backing Agent 的处理须另测，不能仅凭缓存策略宣布提交语义已满足。
- 后续补齐输入取消/长停顿、审批和实时状态可见性、断线后的提交确认与防重、语音额度以及延迟。T01 余项验收后，T02 根据本轮已验证路线冻结能力边界；本报告仍不把完整 T01 或 M1 标记完成。

## 6. 复现入口

以下脚本是依赖探针，不是正式桥接，也不自动选择或创建替代生产会话。Windows 受限沙箱可能阻止子进程或本机 socket；本次实际协议测试在获准的沙箱外执行。没有持久修改系统设置。

```powershell
# 只读检查；指定 ID 时读取最近一页历史，但只报告类型和数量。
node tools/validation/codex-readonly.mjs --thread <native-thread-uuid>

# 完整结果只允许读回已命名为 MirTar 验证的专用测试会话。
node tools/validation/codex-readonly.mjs --thread <test-thread-uuid> --check-test-session

# 检查默认共享控制入口；入口不存在时预期失败。
node tools/validation/codex-readonly.mjs --proxy

# 通过本机 Codex 生成与该版本匹配的实验 Schema。
codex app-server generate-json-schema --experimental --out .private/codex-schema

# 离线生成 WAV；文件已存在时拒绝覆盖。
powershell.exe -NoProfile -File tools/validation/New-TestAudio.ps1

# 已命名为 MirTar 验证、已空闲的专用桌面会话。
node tools/validation/codex-audio.mjs --thread <test-thread-uuid> --mode attachment --audio .private/codex-validation/synthetic-input.wav --confirm-test-thread

# 独立临时会话；不是桌面同会话验收。
node tools/validation/codex-audio.mjs --ephemeral --mode attachment --audio .private/codex-validation/synthetic-input.wav --confirm-test-thread
node tools/validation/codex-audio.mjs --ephemeral --mode realtime --audio .private/codex-validation/synthetic-input.wav --confirm-test-thread
node tools/validation/codex-audio.mjs --ephemeral --mode webrtc --audio .private/codex-validation/synthetic-input.wav --confirm-test-thread

# 生成实际命令测试录音，经原生识别后投递到已存在的桌面测试会话。
powershell.exe -NoProfile -File tools/validation/New-TestAudio.ps1 -Scenario agent-task
node tools/validation/codex-audio.mjs --ephemeral --mode webrtc --audio .private/codex-validation/synthetic-agent-task.wav --queue-target <test-thread-uuid> --confirm-test-thread
```

附件和直接 WebSocket 的负面结果是预期诊断结果；进程退出或 `turn/completed` 本身不能判定音频识别成功。WebRTC 探针会核对 `assistant` 角色转写中的口令。本次没有真实设备交互、固件构建或刷机。

### 参考与证据层级

- 本机 CLI 生成的实验 Schema、实际 JSON-RPC/媒体事件、桌面测试会话读回：本报告本机结论的直接依据。
- [OpenAI Docs：App Server](https://learn.chatgpt.com/docs/app-server)：握手、历史、任务及事件语义。
- [OpenAI Docs：Voice](https://learn.chatgpt.com/docs/features/voice)：产品支持已有任务语音，但依赖账号、工作区及发布状态；不能替代第三方接入测试。
- [OpenAI Docs：配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)：语音功能开关不绕过客户端或发布条件。
- [上游录音输入定义](https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/protocol/src/user_input.rs)、[不支持媒体的处理](https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/core/src/context_manager/normalize.rs)、[实时认证与版本](https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/core/src/realtime_conversation.rs)、[WebRTC 调用创建](https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/core/src/client.rs)：固定公开源码快照用于解释和选择试验参数，未验证为本机二进制的精确构建提交。
- [OpenAI Docs：开发者命令](https://learn.chatgpt.com/docs/developer-commands)：官方 `codex queue` 入口。
- [上游原生队列服务](https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/ext/queue/src/service.rs)：跨进程队列发现与消费的解释依据，不代替本机延迟测量。
