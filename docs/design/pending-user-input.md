# Issue #1：桌面问题转发与语音回答

状态：接入调查完成第一轮，**尚未实现**。本设计不宣称 0.5.3 已支持卡片问答。
对应 [GitHub issue #1](https://github.com/Charlesmpc/MirTar/issues/1)。仅使用通用场景，无原始截图或个人问题内容。

## 为什么现在收不到

当前 `CodexAdapter.history()` 只返回已完成 turn 的 final_answer。
语音结束后，`beginAudio().commit()` 把识别文本交给 `thread/queue/add`，这是普通新消息。
`CodexRpc` 对没有处理的服务端请求返回桌面处理提示，`AgentAdapter` 尚无交互请求的订阅或回答接口。

卡片连上的是桥接；桥接独立启动一个 `codex app-server --listen stdio://`。
桌面原会话由桌面的进程执行。两者能共享持久化历史与队列，但不能据此认定共享内存中的 pending request。
把弹窗答案发进普通队列，既不能保证解除原请求，还可能造成重复任务。

## 2026-10-26 只读调查

- 对当前安装的 Codex `0.164.0-alpha.11.1` 重新生成含 `--experimental` 的协议 schema。
- `ServerRequest` 存在 `item/tool/requestUserInput`；参数包含 threadId、turnId、itemId、isBlocking 和 questions。
  每个问题有 id、正文、可选 options、isOther、isSecret。响应按 question.id 映射到 answers 数组。
- `ServerNotification` 包含 `serverRequest/resolved`。客户端必须保留请求 ID 并跟随其生命周期，不能靠文字相似度匹配。
- 生成的客户端方法列表中，没有通用的“列出另一个 app-server 的待回答请求／回答它”方法。
  elicitation 计数方法只管理等待计时，不是答案提交接口。
- 对已配置专用会话做 metadata-only 读取：独立进程 loaded count 为 0，该会话在这个进程中显示 notLoaded；没有返回历史正文。
  这支持“独立进程没有附着桌面运行时”的判断，不代表桌面会话不存在或无法读取历史。
- 尝试安装版本提供的 `app-server proxy`，连接默认本地控制 socket 失败，Windows 报 `os error 10050`。
  这是当前机器的连接失败，不能推断所有 Windows 版本都不支持。

本轮未 resume、创建或启动任何会话，未回答／拒绝任何弹窗，未上传录音、截图、私人配置或日志。
调查没有验证“桌面弹窗 → 卡片回答”的闭环。

官方依据：[Codex App Server](https://learn.chatgpt.com/docs/app-server)。文档确认请求／响应和 resolved 生命周期，
没有保证另一独立进程可以接管桌面原请求。实验接口应以安装版本的 schema 为准。

## 建议先做的技术验证

第一步只验证连接，不先做整套卡片界面：

1. 找到桌面实际使用且允许外部客户端附着的同一 app-server 端点，确认认证与连接生命周期。
   默认 proxy 当前不可用，需要核实它是否对应桌面服务，而不能任意启动一个新 daemon 代替。
2. 使用专门测试会话发出一个无敏感内容的问题，旁路客户端收到原 requestId、threadId、turnId、itemId、question.id。
3. 通过原连接的合法响应路径填写该请求；确认原任务继续、桌面弹窗消失，且桌面抢先回答时会产生 resolved。
   不 resume 或接管现有工作会话，不把答案转为新消息。
4. 验证重连后的待处理请求恢复。若端点不提供恢复，明确退回电脑处理，不伪造恢复成功。

如果当前桌面版本不提供可用端点，问题就是桌面集成能力的限制。可继续调查桌面官方扩展接口；
不能用恢复到另一进程或新建 Agent 会话替代“桌面可继续操作的原会话”这一产品要求。
UI 自动化只能作为另行评估的 Windows 适配后备方案，稳定性和后台操作能力需要实测。

## 通道验证通过后的实现

将问题抽象在 AgentAdapter，而不是放进 Windows 层：

```text
AgentInteraction {
  sessionId, turnId, itemId, interactionId,
  questions: [{ id, text, options?, secret? }],
  status: pending | answered | resolved | expired
}

subscribeInteractions(sessionId, onEvent) -> unsubscribe
respondInteraction(sessionId, interactionId, answersByQuestionId) -> receipt
```

`interactionId` 是桥接产生的、与原连接请求 ID 绑定的不透明标识；不能把它当成通用 Codex API 的新方法。
原始请求只保存在匹配会话与连接的上下文。断线、切会话和桌面回答时要清理过期映射。

设备协议增加 question、question_resolved 事件，以及带 interactionId/questionId 的 answer_begin/answer_commit。
卡片显示“等待你的回答”和问题，上下翻阅。OK 开始说话，再按 OK 结束；复用现有原生流式 ASR，
收齐最后一段后走 `respondInteraction`，不能进入普通 `thread/queue/add`。
现有 `awaitingReply` 对普通录音的 busy 限制需要区分“正在回答该请求”，否则原任务等待时无法录音。

先打通单个自由回答问题，再扩展选项、多问题和跳过。语音回答仍要绑定原问题 ID，不能自动猜选项。
普通澄清问题和权限／执行审批分开建模，不能因为可回答问题就自动批准操作。
secret 类型提示留在电脑安全输入；卡片不记录其答案。

## 验收边界

- 不增加独立 ASR 服务，仍使用现有 Codex 原生音频链路。
- 桌面先回答、任务结束、重复包或蓝牙／Wi-Fi 断线均不能重复提交或串会话。
- 明确区分已接收、已回答、已解除请求与未知结果；未知结果不自动重发。
- 需要真实桌面请求的闭环证据；合成 adapter 测试通过不能替代该证据。
