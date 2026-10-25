# 硬件源码与许可证

[English](UPSTREAM.md)

`components/bsp` 复制自 [FoloToy/ai-passport](https://github.com/FoloToy/ai-passport) 提交 `006c2279852e352a8433b2c21e5e09be2ca36f77`，遵循 MIT 许可证；原始版权与许可保留在 `components/bsp/LICENSE`。没有复制上游演示界面和主应用。MirTar 自行实现 `main`、设备状态、预置 Wi-Fi 连接、音频传输、绑定和 LVGL 界面。

MirTar 按用户选择使用 ESP-IDF **5.5.6**，覆盖上游用于复现的 5.5.3 基线，并在应用 manifest 固定 LVGL **9.5.0**。生成的组件锁文件记录解析结果。BSP 保留实际板卡引脚、屏幕遮罩、按键 ADC 与 ES8311/电池行为。

`assets/mirtar_font_16.c` 由 Noto Sans SC 和 `tools/generate_font.py` 生成，源字库哈希记录在生成文件头部。字库来源为 [Google Fonts / Noto Sans SC](https://github.com/google/fonts/tree/main/ofl/notosanssc)，SIL OFL 1.1 许可证保留在 `assets/OFL.txt`。源 TTF 留在 `.private/fonts`，子集与字符清单可复现，不是复制 Windows 专有字体。光栅化使用 Pillow/FreeType，生成 plain 4bpp 并逐字符验证打包像素。覆盖 7,540 个码位，位图 906,342 字节，不含描述表与链接影响。字库真机渲染是单独的硬件验收项。
