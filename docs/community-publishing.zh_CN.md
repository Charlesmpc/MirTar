# 发布到 AI Passport 社区

社区玩法与 GitHub Release 分别维护。GitHub 的提交、标签和 Release 不会自动替换社区固件；
发布 `0.5.2` 等后续版本时，需要在同一个社区玩法中提交更新，经审核后才成为社区可安装版本。
卡片当前没有 OTA，安装新版仍需刷机。

2026-10-25 的 v0.5.1 投稿回执：项目 **1619**，版本记录 **3705**，状态为 **pending / 待审核**。
固件哈希和双语简介、使用方法已从服务端读回核对。审核状态以创作者中心的最新记录为准。

## 官方入口与材料

从[玩法社区](https://ai-passport.folotoy.cn/plays/)选择“＋发布玩法”，进入创作者中心。
使用最新版官方发布助手检查固件、准备双语简介、独立使用方法、更新日志、封面和源码链接。
作者在官网为原项目生成 AI 更新授权后，可按其明确授权直接提交，不必再次确认。

依据[官方发布说明](https://github.com/FoloToy/ai-passport/blob/main/docs/development/release/publish-to-community.zh_CN.md)，需要：

- 完整合并镜像，从 `0x0` 刷入；不能使用单独的应用镜像。
- JPEG / PNG / WebP 封面，最多 10 MiB。
- 公开 HTTPS Git 仓库地址，以及中英文标题、简介。

MirTar 的合并镜像名为 `MirTar-full.bin`；上传前需按发布助手要求验证布局和打包格式，不能只改文件名。
正式表单与最终校验以官网当时显示为准。

## 公版与私有材料

只使用 `Build-Firmware.ps1` 生成并通过 `check-public-firmware.py` 校验的公版完整镜像。
从 v0.5.1 的公版全新配置启动时，主机列表为空，用户通过 Add server 添加自己的电脑；
不读取作者的真实配置，也不预置其 Wi-Fi 或绑定信息。

`Build-PersonalFirmware.ps1` 的个人镜像、真实配置、备份、日志和配对数据留在本机 `.private/`，不能上传。
新蓝牙添加、多主机隔离和配对恢复仍待真机验收；编译与主机测试不能写成真机通过。

封面使用 [MirTar 概念示意图](images/mirtar-cover.png)，并非实拍或截图。
提交前用图片查看工具检查实际上传的文件，确认完整成品且没有个人信息。
简介、使用方法、更新日志独立提交；[v0.5.1 双语材料](community/v0.5.1/)已按本版实现整理。

## 更新同一个玩法

1. 在[创作者中心](https://ai-passport.folotoy.cn/account/)进入原有 MirTar 项目。
   已有草稿或待审核版本时先处理该版本；只有作者明确要求时才撤回，不另建相同玩法绕过冲突。
2. 从该项目复制官网生成的 AI 更新授权指令。首次创建的一次性授权不能用于更新；
   更新授权必须对应原项目 ID。
3. 所有发布命令设置 `FOLOTOY_AI_PASSPORT_URL=https://ai-passport.folotoy.cn`。
   用 `authorize --code-stdin` 兑换授权，凭据放在仓库外，再用 `whoami`、`projects` 核对范围和项目状态。
   官网因草稿阻止生成授权时按官网提示处理，不能改用创建授权或覆盖冲突。
4. 校验固件与 3:4 封面，分别使用 `--instructions-zh-file` / `--instructions-en-file`
   和 `--changelog-zh-file` / `--changelog-en-file` 传入 UTF-8 文本。
   更新使用原项目 ID 和 `submit --auto`；公开源码自动决定二创支持，不传二创策略标记。
5. 以服务端回执和再次查询的结果为准。`pending` 只代表已提交审核，并非已公开。
   结果不确定先查询项目，不能为重试重复创建玩法。

`tools/publish-community.py` 会再次校验公版镜像，拒绝含个人预置配置的产物。
发布不需要连接卡片，也不会自动刷机。

## 建议投稿文案

中文标题：MirTar｜把电脑上的编程 Agent 带到手里

英文标题：MirTar | Your coding agent, in your hand

简介与独立使用步骤见 `docs/community/v0.5.1/`。源码填写当前公开仓库
`https://github.com/Charlesmpc/MirTar`，不能填写旧私有归档或上游模板仓库。
