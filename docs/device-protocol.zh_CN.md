# 设备协议 v1

[English](device-protocol.md)

M1 使用 `/device` 上的原生 WebSocket 客户端，JSON 文本控制帧与二进制 PCM 音频帧。设备协议不包含 Codex 方法名；具体 Agent 适配器留在 Windows 桥接内部。

## 绑定与会话

卡片连接配置的目标地址，发送 `{type:"hello",version:1,deviceId,bootId}`；`bootId` 是 16 随机字节的小写十六进制编码，共 32 字符。桥接返回 `{type:"challenge",challenge}`，其中挑战是 32 随机字节编码的 64 字符十六进制串。卡片返回 `{type:"auth",proof}`；`proof` 是 HMAC-SHA256（UTF-8 共享密钥，UTF-8 挑战字符串）的小写十六进制结果。必须五秒内完成认证，同一设备只允许一个活动连接。

成功返回 `{type:"bound",version:1,adapterId,sessions,audio,capabilities}`。会话只包含配置允许且当前可用的原生 ID/显示名。当前明确声明 `liveRuntimeState:false`、`approvals:false`、`tts:false`、`textReply:true`。发送 `{type:"select",sessionId}` 选择会话，收到 `{type:"selected",sessionId}`；不可用 ID 不会被替代或静默新建。

## 两次 OK 录音

第一次 OK 发送 `{type:"begin",id}`，`id` 为非零 32 位整数，在每次开机内递增。桥接锁定该次输入对应的会话并返回状态消息。采样为 16 kHz、单声道、有符号小端 PCM16。音频帧布局如下：

| 偏移 | 字节 | 含义 |
| --- | --- | --- |
| 0 | 4 | ASCII `MTA1` |
| 4 | 4 | 输入 ID，uint32 小端 |
| 8 | 4 | 从零开始的序号，uint32 小端 |
| 12 | 2–1280，偶数 | PCM 数据；当前固件每帧 640 字节 / 20 ms |

必须顺序收齐，不接受重复或缺号。最多缓存 960,000 字节（30 秒）；桥接端录音 35 秒过期。提交前录音只在桥接内存，不发送给 Agent 原生语音服务。

第二次 OK 发送 `{type:"commit",id,frames}`，帧数必须与全部已收帧相同。`{type:"cancel"}` 丢弃未提交录音；处理中的取消只能尽力执行，不能撤回已被原生队列接受的任务。录音中禁止切换会话；提交后切换阅读会话不会取消 Agent 任务。

## 回复与恢复

`state` 含 `sessionId`、输入 `id` 和准确状态：`recording`、`recognizing`、`submitting`、`accepted`、`completed`、`submission_unknown`。`accepted` 表示原生队列确认接收，不表示执行完成。`completed` 通过原生客户端消息身份，或仅在有界内存保留的本次完整用户文本关联，并排除提交前的基线轮次。`reply` 含 `sessionId`、`turnId`、`text`、`completed`、`truncated`。当前 Codex 路线每 1.5 秒读取一次历史，只输出已完成的正式回复；卡片显示前校验会话 ID。

桥接在原生提交前保存最小回执，以 SHA256(deviceId + ":" + bootId + ":" + inputId) 为键。同一输入身份在桥接重启后也不再重复入队；回执仅保存提交身份与状态，不保存录音、转写文本或会话历史。未知回执不自动重试。桥接关闭或断网不代表桌面已经接受的任务被取消。

容量：客户端控制消息最多 2,048 字节；单个入站 WebSocket 消息最多 8,192 字节；等待处理的入站数据最多 128 KiB；发给卡片的消息最多 8,000 UTF-8 字节。回复文本按 Unicode 边界截到最多 6,144 字节，如 JSON 转义后过长则继续缩减。桥接不记录转写文本或原始麦克风音频；卡片仅保留当前与待显示回复的有界缓存，不维护另一套正式历史。

桥接每 15 秒发送 ping，下个周期仍未响应则断开。Wi-Fi 会轮换尝试预置项，WebSocket 重连不重放输入。未知提交、原生状态不可用、麦克风错误与播放能力必须区别于成功。v1 不自动开放防火墙、不宣称提供公网监听、云端绑定或远程认证。
