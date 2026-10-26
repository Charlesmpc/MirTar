#include "ui.h"
#include "bsp_display.h"
#include "lvgl.h"
#include <stdio.h>
#include <string.h>
#include "esp_app_desc.h"
LV_FONT_DECLARE(mirtar_font_16);
static lv_obj_t *top, *battery_text, *header, *viewport, *text, *footer, *setup_qr;
static lv_font_t font;
static uint32_t paper, ink, muted, accent;
static char build_flavor[21];
void mt_ui_flavor(const char *name) { snprintf(build_flavor,sizeof(build_flavor),"%s",name?name:""); }
void mt_ui_init(bool reading_skin) {
    paper = reading_skin ? 0x172033 : 0x122021;
    ink = reading_skin ? 0xe7edf8 : 0xeef4ec;
    muted = reading_skin ? 0xa5b2cd : 0xa0b6ad;
    accent = reading_skin ? 0xb7c6fa : 0xa8d9b0;
    font = mirtar_font_16; font.fallback = &lv_font_montserrat_14;
    lv_obj_t *screen = lv_obj_create(NULL);
    lv_obj_remove_style_all(screen);
    lv_obj_set_style_bg_color(screen, lv_color_hex(paper), 0);
    lv_obj_set_style_bg_opa(screen, LV_OPA_COVER, 0);
    lv_obj_set_style_text_font(screen, &font, 0);
    lv_obj_set_style_text_color(screen, lv_color_hex(ink), 0);
    top = lv_label_create(screen); lv_obj_set_pos(top, 22, 8); lv_obj_set_size(top, 120, 18);
    lv_obj_set_style_text_font(top, &font, 0);
    lv_obj_set_style_text_color(top, lv_color_hex(muted), 0);
    battery_text = lv_label_create(screen); lv_obj_set_pos(battery_text, 164, 8); lv_obj_set_size(battery_text, 54, 18);
    lv_obj_set_style_text_font(battery_text, &lv_font_montserrat_14, 0);
    lv_obj_set_style_text_color(battery_text, lv_color_hex(muted), 0);
    lv_obj_set_style_text_align(battery_text, LV_TEXT_ALIGN_RIGHT, 0);
    header = lv_label_create(screen); lv_obj_set_pos(header, 16, 28); lv_obj_set_size(header, 208, 22);
    viewport = lv_obj_create(screen); lv_obj_remove_style_all(viewport);
    lv_obj_set_pos(viewport, 12, 54); lv_obj_set_size(viewport, 216, 232);
    lv_obj_add_flag(viewport, LV_OBJ_FLAG_SCROLLABLE); lv_obj_set_scrollbar_mode(viewport, LV_SCROLLBAR_MODE_OFF);
    lv_obj_set_scroll_dir(viewport, LV_DIR_VER);
    if (reading_skin) {
        lv_obj_set_style_bg_color(viewport, lv_color_hex(0x243049), 0);
        lv_obj_set_style_bg_opa(viewport, LV_OPA_COVER, 0);
        lv_obj_set_style_radius(viewport, 8, 0);
    }
    text = lv_label_create(viewport); lv_obj_set_pos(text, 4, 4); lv_obj_set_width(text, 208);
    lv_label_set_long_mode(text, LV_LABEL_LONG_WRAP);
    lv_obj_set_style_text_font(text, &font, 0); lv_obj_set_style_text_color(text, lv_color_hex(ink), 0);
    lv_obj_set_style_text_line_space(text, 3, 0);
    footer = lv_label_create(screen); lv_obj_set_pos(footer, 18, 289); lv_obj_set_size(footer, 204, 22);
    lv_obj_set_style_text_color(footer, lv_color_hex(accent), 0);
    lv_screen_load(screen);
}
void mt_ui_render(const mt_state_t *s, const char *status, const char *body, int battery) {
    char info[80];
    if (battery >= 0) snprintf(info, sizeof(info), "%d%%", battery);
    else snprintf(info, sizeof(info), "--");
    lv_label_set_text(battery_text, info);
    if(build_flavor[0])snprintf(info,sizeof(info),"%s-%s",esp_app_get_description()->version,build_flavor);
    else snprintf(info, sizeof(info), "MirTar %s", esp_app_get_description()->version);
    lv_label_set_text(top, s->bound ? s->target_name : s->page == MT_HOME || s->page == MT_MACHINES ? info : s->page == MT_SETUP ? "Config upload" : s->transport == MT_BLUETOOTH ? "Bluetooth" : s->wifi ? "Wi-Fi" : "Offline");
    if (s->page != MT_SETUP) { if (setup_qr) lv_obj_add_flag(setup_qr, LV_OBJ_FLAG_HIDDEN); lv_obj_set_pos(text, 4, 4); }
    if ((s->page == MT_READING||s->page==MT_QUESTION||s->page==MT_ANSWER_MENU) && s->selected < s->session_count) {
        snprintf(info, sizeof(info), "Codex / %s", s->sessions[s->selected].name); lv_label_set_text(header, info);
    }
    else lv_label_set_text(header, s->page == MT_SETUP ? "扫码上传 config-file" : "MirTar / Codex");
    if (body) { lv_label_set_text(text, body); lv_obj_scroll_to_y(viewport, 0, LV_ANIM_OFF); }
    lv_label_set_text(footer, status);
}
void mt_ui_recording(unsigned seconds, unsigned level) {
    char body[128];
    snprintf(body, sizeof(body), "正在录音\n\n%02u:%02u\n\n音量 %u\n\n再按 OK 结束发送", seconds / 60, seconds % 60, level);
    lv_label_set_text(text, body);
}
void mt_ui_scroll(int direction) { lv_obj_scroll_by(viewport, 0, direction > 0 ? -96 : 96, LV_ANIM_OFF); }
void mt_ui_skin(bool reading_skin) {
    paper=reading_skin?0x172033:0x122021; ink=reading_skin?0xe7edf8:0xeef4ec;
    muted=reading_skin?0xa5b2cd:0xa0b6ad; accent=reading_skin?0xb7c6fa:0xa8d9b0;
    lv_obj_set_style_bg_color(lv_screen_active(),lv_color_hex(paper),0);
    lv_obj_set_style_text_color(lv_screen_active(),lv_color_hex(ink),0);
    lv_obj_set_style_text_color(text,lv_color_hex(ink),0);
    lv_obj_set_style_text_color(top,lv_color_hex(muted),0); lv_obj_set_style_text_color(battery_text,lv_color_hex(muted),0);
    lv_obj_set_style_text_color(footer,lv_color_hex(accent),0);
    lv_obj_set_style_bg_color(viewport,lv_color_hex(0x243049),0);
    lv_obj_set_style_bg_opa(viewport,reading_skin?LV_OPA_COVER:LV_OPA_TRANSP,0);
    lv_obj_set_style_radius(viewport,reading_skin?8:0,0);
}
void mt_ui_setup(const char *ssid, const char *password) {
    if (!setup_qr) setup_qr = lv_qrcode_create(viewport);
    if (!setup_qr) return;
    lv_qrcode_set_size(setup_qr, 128); lv_obj_set_pos(setup_qr, 44, 2);
    lv_qrcode_set_dark_color(setup_qr, lv_color_hex(0x172033)); lv_qrcode_set_light_color(setup_qr, lv_color_hex(0xffffff));
    char payload[160]; snprintf(payload, sizeof(payload), "WIFI:T:WPA;S:%s;P:%s;;", ssid, password);
    lv_qrcode_update(setup_qr, payload, strlen(payload)); lv_obj_remove_flag(setup_qr, LV_OBJ_FLAG_HIDDEN);
    char body[180]; snprintf(body, sizeof(body), "%s\n密码 %s\nhttp://192.168.4.1", ssid, password);
    lv_obj_set_pos(text, 4, 138); lv_label_set_text(text, body); lv_obj_scroll_to_y(viewport, 0, LV_ANIM_OFF);
    lv_label_set_text(footer, "长按 OK 退出配网");
}
