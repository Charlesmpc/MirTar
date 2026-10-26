# 社区 0.5.2 更新资料

更新目标：MirTar，社区项目 **1619**，保留现有玩法与来源关系。
本目录是准备好的投稿资料，是否提交及审核通过以官网回执为准。

| 字段 | 中文 | English |
| --- | --- | --- |
| 当前玩法简介 | [description.zh.txt](description.zh.txt) | [description.en.txt](description.en.txt) |
| 首次使用步骤 | [instructions.zh.txt](instructions.zh.txt) | [instructions.en.txt](instructions.en.txt) |
| 本次更新日志 | [changelog.zh.txt](changelog.zh.txt) | [changelog.en.txt](changelog.en.txt) |

源码：[Charlesmpc/MirTar](https://github.com/Charlesmpc/MirTar)。
配套 Windows 桥接与公版镜像：[v0.5.2 Release](https://github.com/Charlesmpc/MirTar/releases/tag/v0.5.2)。
封面：[MirTar 概念示意图](../../images/mirtar-cover.png)，并非实拍。

社区只使用公版完整镜像 `MirTar-full.bin`，安装起始地址 `0x0`：

```text
Version: 0.5.2
SHA-256: f944ffa9d940fe3233f5e6ee102f9b01851f5804ebc97ccd64b612c73ce8c287
```

公版的配置区为空，新安装从空主机列表开始，使用 Add server 添加自己的电脑。
真实配置、个人预置镜像、配对资料及授权凭据不属于投稿内容。
发布通过 `tools/publish-community.py` 再次检查公版标记、版本、布局和实际镜像内容；
该入口拒绝个人镜像，并自动选取已验证的公版固件。

更新必须使用项目 1619 对应的官方更新授权，不复用首次创建授权，不另建重复玩法。
简介、使用方法和更新日志分开提交；分类由平台自动判断，沿用有效标签。
