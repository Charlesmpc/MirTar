# Hardware source and licenses

[简体中文](UPSTREAM.zh_CN.md)

`components/bsp` is copied from [FoloToy/ai-passport](https://github.com/FoloToy/ai-passport), commit `006c2279852e352a8433b2c21e5e09be2ca36f77`, under its MIT license. The original copyright/license is retained at `components/bsp/LICENSE`. The upstream demo UI and application are not copied. MirTar owns `main`, the device state machine, configured Wi-Fi connection, audio transport, binding and its LVGL screens.

MirTar deliberately selects ESP-IDF **5.5.6**, overriding the upstream reproduction baseline of 5.5.3, and pins LVGL **9.5.0** at the application manifest. The generated component lock records resolved dependencies. `components/bsp` retains the actual board pin assignments, display masking, button ADC and ES8311/battery behavior.

`assets/mirtar_font_16.c` is generated from Noto Sans SC using `tools/generate_font.py`; its source font hash is recorded in the generated header. Font source: [Google Fonts / Noto Sans SC](https://github.com/google/fonts/tree/main/ofl/notosanssc), licensed under SIL OFL 1.1, retained in `assets/OFL.txt`. Source TTF stays in `.private/fonts`; the subset and code-point inventory are reproducible material, not a copy of a Windows proprietary font. Rasterization uses Pillow/FreeType, packs plain 4bpp glyphs and verifies every packed pixel. Coverage is 7,540 code points; the bitmap is 906,342 bytes before descriptor tables and linking. Actual on-card font rendering is a separate hardware check.
