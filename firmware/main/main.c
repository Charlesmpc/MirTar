#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdatomic.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "esp_event.h"
#include "esp_wifi.h"
#include "esp_netif.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "esp_heap_caps.h"
#include "esp_system.h"
#include "esp_websocket_client.h"
#include "nvs_flash.h"
#include "mbedtls/md.h"
#include "cJSON.h"
#include "bsp_display.h"
#include "bsp_button.h"
#include "bsp_audio.h"
#include "bsp_battery.h"
#include "state.h"
#include "ui.h"
#include "runtime_config.h"
#include "wifi_portal.h"
#include "ble_transport.h"

typedef enum { EV_KEY, EV_WIFI_ON, EV_WIFI_OFF, EV_WS_ON, EV_WS_OFF, EV_JSON, EV_AUDIO_DONE, EV_BLE_PIN, EV_CONFIG } event_kind_t;
typedef struct { event_kind_t kind; int key, action; uint32_t generation; char *json; } event_t;
typedef struct { const char *name, *url, *secret, *bluetooth_name; } target_t;
static QueueHandle_t events;
static TaskHandle_t audio_task_handle;
static SemaphoreHandle_t audio_stopped;
static esp_websocket_client_handle_t websocket;
static mt_state_t state;
static target_t targets[4];
static int target_count, target_index;
static wifi_config_t wifi_networks[1];
static int wifi_count, wifi_index;
static int64_t wifi_retry_at, wifi_attempt_deadline;
static bool wifi_attempt_active;
static bool wifi_initialized, wifi_started;
static esp_netif_t *wifi_netif;
static uint32_t generation;
static const char *device_id;
static char boot_id[33], reply[MT_REPLY_MAX + 1], footer[96] = "正在连接 Wi-Fi";
static char rx[8193];
static size_t rx_used;
static atomic_bool audio_running, audio_submit, audio_busy;
static atomic_uint audio_seconds, audio_level;
static atomic_bool audio_ok;
static bool manual_machine_selection, follow_reply = true;
static char pending_reply[MT_REPLY_MAX + 1];
static uint32_t recording_id;
static char submitted_session[64];
static cJSON *device_config, *pair_candidate;
static int home_index;
static char *pending_config;
static int64_t config_apply_at, portal_close_at, pair_deadline, pair_close_at, wifi_deadline;
static char pair_nonce[33], pair_server_id[41];
static bool pair_finished;
static void show_home(void);
static void read_settings(void);
static void enter_pairing(void);
static void enter_config_upload(void);

static const char *str(cJSON *o, const char *key) {
    cJSON *v = cJSON_GetObjectItemCaseSensitive(o, key);
    return cJSON_IsString(v) ? v->valuestring : "";
}
static void post(event_t event) {
    if (xQueueSend(events, &event, 0) != pdTRUE && event.json) free(event.json);
}
static void status(const char *value) { snprintf(footer, sizeof(footer), "%s", value); }
static void render(const char *body) {
    int battery = bsp_battery_soc();
    if (!bsp_lvgl_lock(200)) return;
    mt_ui_render(&state, footer, body, battery);
    bsp_lvgl_unlock();
}
static bool send_json(cJSON *message) {
    char *text = cJSON_PrintUnformatted(message); cJSON_Delete(message);
    if (!text) return false;
    int len = strlen(text);
    bool ok = state.transport == MT_BLUETOOTH ? mt_ble_send(text, len, false) :
        websocket && esp_websocket_client_is_connected(websocket) &&
        esp_websocket_client_send_text(websocket, text, len, pdMS_TO_TICKS(1000)) == len;
    free(text); return ok;
}
static cJSON *message(const char *type) {
    cJSON *o = cJSON_CreateObject(); cJSON_AddStringToObject(o, "type", type); return o;
}
static void choose_session(void) {
    state.page = MT_READING; follow_reply = true; pending_reply[0] = 0; reply[0] = 0;
    cJSON *o = message("select"); cJSON_AddStringToObject(o, "sessionId", state.sessions[state.selected].id);
    if (!send_json(o)) status("连接已断开"); else status("正在打开会话");
    render("正在读取会话内容");
}
static void show_sessions(void) {
    char body[800] = "选择会话\n\n";
    for (int i = 0; i < state.session_count; i++) {
        size_t offset = strlen(body);
        snprintf(body + offset, sizeof(body) - offset, "%s %s\n\n", i == state.selected ? ">" : " ", state.sessions[i].name);
    }
    state.page = MT_SESSIONS; status("上下选择  OK 进入"); render(body);
}
static void show_home(void) {
    char body[300];
    if(target_count)snprintf(body,sizeof(body),"%s Server list (%d)\n\n%s Add server\n\n%s Add config-file",
        home_index==0?">":" ",target_count,home_index==1?">":" ",home_index==2?">":" ");
    else snprintf(body,sizeof(body),"%s Add server\n\n%s Add config-file",home_index==1?">":" ",home_index==2?">":" ");
    state.page=MT_HOME;status("上下选择  OK 进入");render(body);
}
static void show_machines(void) {
    if(!target_count){home_index=1;show_home();return;}
    char body[512] = "选择电脑\n\n";
    for (int i = 0; i < target_count; i++) {
        size_t offset = strlen(body);
        snprintf(body + offset, sizeof(body) - offset, "%s %s\n\n", i == target_index ? ">" : " ", targets[i].name);
    }
    state.page = MT_MACHINES; status("上下选择  OK 进入"); render(body);
}
static void show_transports(void) {
    char body[300];
    snprintf(body, sizeof(body), "%s\n\n连接方式\n\n%s Bluetooth\n\n%s Wi-Fi\n\n蓝牙首次连接需要配对", targets[target_index].name,
        state.transport == MT_BLUETOOTH ? ">" : " ", state.transport == MT_WIFI ? ">" : " ");
    state.page = MT_TRANSPORT; status("上下选择  OK 连接"); render(body);
}
static void stop_audio(void) {
    atomic_store(&audio_submit, false); atomic_store(&audio_running, false);
    if (atomic_load(&audio_busy)) {
        if (xSemaphoreTake(audio_stopped, pdMS_TO_TICKS(2500)) != pdTRUE) {
            status("录音停止失败，请重启"); render(NULL); return;
        }
    }
    state.recording = false;
}
static void websocket_event(void *arg, esp_event_base_t base, int32_t id, void *data) {
    (void)base;
    uint32_t current = (uint32_t)(uintptr_t)arg;
    if (id == WEBSOCKET_EVENT_CONNECTED) post((event_t){ .kind = EV_WS_ON, .generation = current });
    else if (id == WEBSOCKET_EVENT_DISCONNECTED) { rx_used = 0; post((event_t){ .kind = EV_WS_OFF, .generation = current }); }
    else if (id == WEBSOCKET_EVENT_DATA) {
        esp_websocket_event_data_t *e = data;
        if (e->op_code == 0x9 || e->op_code == 0xa) return;
        if (e->payload_offset == 0) rx_used = 0;
        if (e->payload_len <= 0 || e->payload_len > 8192 || e->data_len < 0 ||
            e->payload_offset != (int)rx_used || rx_used + e->data_len > 8192) return;
        memcpy(rx + rx_used, e->data_ptr, e->data_len); rx_used += e->data_len;
        if (rx_used == (size_t)e->payload_len) {
            rx[rx_used] = 0;
            post((event_t){ .kind = EV_JSON, .generation = current, .json = strdup(rx) }); rx_used = 0;
        }
    }
}
static void connect_websocket(void) {
    if (websocket || !state.wifi || state.transport != MT_WIFI) return;
    esp_websocket_client_config_t config = { .uri = targets[target_index].url, .buffer_size = 1024,
        .task_stack = 6144, .reconnect_timeout_ms = 3000, .network_timeout_ms = 3000 };
    websocket = esp_websocket_client_init(&config);
    if (!websocket) { status("电脑连接初始化失败"); render(NULL); return; }
    esp_websocket_register_events(websocket, WEBSOCKET_EVENT_ANY, websocket_event, (void *)(uintptr_t)generation);
    if (esp_websocket_client_start(websocket) != ESP_OK) status("电脑连接失败"); else status("正在连接电脑");
    render(NULL);
}
static void ble_event(mt_ble_event_t event, uint32_t current, const char *json, unsigned pin) {
    if (event == MT_BLE_JSON) post((event_t){ .kind=EV_JSON,.generation=current,.json=strdup(json) });
    else post((event_t){ .kind=event == MT_BLE_ON ? EV_WS_ON : event == MT_BLE_OFF ? EV_WS_OFF : EV_BLE_PIN,.generation=current,.key=(int)pin });
}
static void wifi_event(void *arg, esp_event_base_t base, int32_t id, void *data);
static bool start_wifi(void) {
    if (!wifi_initialized) {
        wifi_netif = esp_netif_create_default_wifi_sta();
        if (!wifi_netif) return false;
        wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
        if (esp_wifi_init(&init) != ESP_OK) { esp_netif_destroy_default_wifi(wifi_netif); wifi_netif = NULL; return false; }
        esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, wifi_event, (void *)(uintptr_t)generation);
        esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, wifi_event, (void *)(uintptr_t)generation);
        esp_wifi_set_storage(WIFI_STORAGE_RAM); esp_wifi_set_mode(WIFI_MODE_STA);
        wifi_initialized = true;
    }
    if (!wifi_started) { if (esp_wifi_start() != ESP_OK) return false; wifi_started = true; }
    return true;
}
static bool disconnect_target(void) {
    stop_audio(); if (atomic_load(&audio_busy)) return false;
    mt_portal_stop();
    free(pending_config);pending_config=NULL;config_apply_at=portal_close_at=wifi_deadline=0;
    cJSON_Delete(pair_candidate);pair_candidate=NULL;pair_deadline=pair_close_at=0;pair_finished=false;
    memset(pair_nonce,0,sizeof(pair_nonce));
    generation++;
    mt_ble_stop();
    if (websocket) { esp_websocket_client_stop(websocket); esp_websocket_client_destroy(websocket); websocket = NULL; }
    if (wifi_started) { wifi_started = false; esp_wifi_stop(); }
    if (wifi_initialized) {
        esp_event_handler_unregister(WIFI_EVENT, ESP_EVENT_ANY_ID, wifi_event);
        esp_event_handler_unregister(IP_EVENT, IP_EVENT_STA_GOT_IP, wifi_event);
        esp_wifi_deinit(); esp_netif_destroy_default_wifi(wifi_netif);
        wifi_netif = NULL; wifi_initialized = false;
    }
    state.wifi = false; wifi_attempt_active = false; wifi_retry_at = wifi_attempt_deadline = 0;
    mt_disconnect(&state);
    return true;
}
static bool portal_submit(char *json) {
    event_t event={.kind=EV_CONFIG,.generation=generation,.json=json};
    return xQueueSend(events,&event,0)==pdTRUE;
}
static void read_settings(void) {
    device_id=str(device_config,"deviceId");target_count=target_index=0;
    memset(targets,0,sizeof(targets));cJSON *item;
    cJSON_ArrayForEach(item,cJSON_GetObjectItem(device_config,"servers")) {
        if(target_count>=4)break;
        targets[target_count++]=(target_t){.name=str(item,"name"),.secret=str(item,"secret"),
            .bluetooth_name=str(item,"bluetoothName"),.url=str(cJSON_GetObjectItem(item,"wifi"),"url")};
    }
    if(bsp_lvgl_lock(200)){mt_ui_skin(!strcmp(str(device_config,"skin"),"reading"));mt_ui_flavor(str(device_config,"buildFlavor"));bsp_lvgl_unlock();}
}
static void enter_config_upload(void) {
    if(!disconnect_target())return;
    manual_machine_selection=true;state.transport=MT_WIFI;state.page=MT_SETUP;
    if(!start_wifi()||!mt_portal_start(device_config,portal_submit)) {
        status("配置热点启动失败");render("长按 OK 返回后重试");return;
    }
    status("连接热点后上传配置文件");render(NULL);
    if(bsp_lvgl_lock(300)){mt_ui_setup(mt_portal_ssid(),mt_portal_password());bsp_lvgl_unlock();}
}
static void enter_pairing(void) {
    if(target_count>=4){status("主机已满，请用配置更新");render(NULL);return;}
    if(!disconnect_target())return;
    manual_machine_selection=false;state.transport=MT_BLUETOOTH;state.page=MT_PAIRING;
    pair_deadline=esp_timer_get_time()+120000000;
    char name[21];snprintf(name,sizeof(name),"Add-%06lX",(unsigned long)(esp_random()&0xffffff));
    if(!mt_ble_start(name,generation,ble_event)){status("蓝牙启动失败");render("长按 OK 返回");return;}
    status("等待电脑添加  仅蓝牙");
    render("在电脑运行\nAdd-Server.ps1\n\n在 Windows 输入卡片配对码\n\n长按 OK 取消");
}

static void connect_target(void) {
    if(!target_count){show_home();return;}
    if (!disconnect_target()) return;
    manual_machine_selection = false; state.page = MT_CONNECTING;
    state.session_count = 0;
    snprintf(state.target_name, sizeof(state.target_name), "%s", targets[target_index].name);
    if (state.transport == MT_BLUETOOTH) {
        const char *name = targets[target_index].bluetooth_name;
        if (!name[0]) name = targets[target_index].name;
        if (!mt_ble_start(name, generation, ble_event)) { status("蓝牙启动失败"); render("长按 OK 返回\n\n可以选择 Wi-Fi 连接"); return; }
        status("等待蓝牙连接"); render("请启动电脑上的桥接\n\n首次连接请在 Windows\n输入卡片上的配对码\n\n已配对的电脑会自动连接");
    } else {
        wifi_count=0;wifi_index=0;memset(wifi_networks,0,sizeof(wifi_networks));
        const cJSON *wifi=mt_config_server_wifi(device_config,target_index);
        if(wifi) {
            memcpy(wifi_networks[0].sta.ssid,str((cJSON *)wifi,"ssid"),strlen(str((cJSON *)wifi,"ssid")));
            memcpy(wifi_networks[0].sta.password,str((cJSON *)wifi,"password"),strlen(str((cJSON *)wifi,"password")));wifi_count=1;
        }
        if (!wifi_count||!start_wifi()) { status("Wi-Fi 不可用"); render("请检查预置 Wi-Fi 配置\n\n长按 OK 返回"); return; }
        wifi_deadline=esp_timer_get_time()+30000000;
        status("正在连接主机 Wi-Fi");render("使用所选主机的 Wi-Fi\n\n30 秒未连上会提示失败\n\n长按 OK 返回");
    }
}
static void wifi_event(void *arg, esp_event_base_t base, int32_t id, void *data) {
    (void)data; uint32_t current = (uint32_t)(uintptr_t)arg;
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) post((event_t){ .kind = EV_WIFI_OFF, .action = 1, .generation = current });
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        post((event_t){ .kind = EV_WIFI_OFF, .generation = current });
    }
    if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) post((event_t){ .kind = EV_WIFI_ON, .generation = current });
}
static void key_event(bsp_btn_t btn, bsp_btn_ev_t ev, void *user) {
    (void)user;
    if (ev == BSP_BTN_CLICK || ev == BSP_BTN_LONG) post((event_t){ .kind = EV_KEY, .key = btn, .action = ev });
}
static void write_le32(uint8_t *p, uint32_t n) { p[0] = n; p[1] = n >> 8; p[2] = n >> 16; p[3] = n >> 24; }
static void audio_worker(void *arg) {
    (void)arg;
    uint8_t frame[652];
    for (;;) {
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
        uint32_t sequence = 0, current_id = recording_id; bool failed = false;
        if (bsp_audio_wake() != ESP_OK) failed = true;
        int64_t start = esp_timer_get_time();
        while (atomic_load(&audio_running) && !failed) {
            if (esp_timer_get_time() - start >= 30000000) { failed = true; break; }
            if (bsp_audio_read(frame + 12, 640) != ESP_OK) { failed = true; break; }
            if (!atomic_load(&audio_running)) break;
            memcpy(frame, "MTA1", 4); write_le32(frame + 4, current_id); write_le32(frame + 8, sequence);
            bool sent = state.transport == MT_BLUETOOTH ? mt_ble_send(frame, sizeof(frame), true) :
                websocket && esp_websocket_client_send_bin(websocket, (const char *)frame, sizeof(frame), pdMS_TO_TICKS(500)) == sizeof(frame);
            if (!sent) { failed = true; break; }
            sequence++;
            unsigned sum = 0;
            for (unsigned i = 12; i < sizeof(frame); i += 2) { int sample = (int16_t)((unsigned)frame[i] | (unsigned)frame[i+1] << 8); sum += abs(sample); }
            atomic_store(&audio_seconds, (esp_timer_get_time() - start) / 1000000);
            atomic_store(&audio_level, sum / 320 / 100);
        }
        if (bsp_audio_sleep() != ESP_OK) { failed = true; atomic_store(&audio_ok, false); }
        bool commit = atomic_load(&audio_submit) && !failed;
        cJSON *o = message(commit ? "commit" : "cancel");
        cJSON_AddNumberToObject(o, "id", current_id); cJSON_AddNumberToObject(o, "frames", sequence);
        if (!send_json(o)) failed = true;
        atomic_store(&audio_running, false);
        post((event_t){ .kind = EV_AUDIO_DONE, .action = commit && !failed, .generation = generation, .key = (int)current_id });
        atomic_store(&audio_busy, false);
        xSemaphoreGive(audio_stopped);
    }
}
static void start_audio(void) {
    if (!mt_can_record(&state) || atomic_load(&audio_busy)) return;
    if (!atomic_load(&audio_ok)) { status("麦克风不可用"); render("请重启后再试\n\n仍失败时检查串口日志"); return; }
    /* Drain the prior cooperative stop acknowledgement before reuse. */
    xSemaphoreTake(audio_stopped, 0);
    state.input_id++; if (!state.input_id) state.input_id = 1; recording_id = state.input_id;
    cJSON *o = message("begin"); cJSON_AddNumberToObject(o, "id", recording_id);
    if (!send_json(o)) { status("连接已断开"); render(NULL); return; }
    state.recording = true; atomic_store(&audio_busy, true); atomic_store(&audio_submit, false);
    atomic_store(&audio_seconds, 0); atomic_store(&audio_level, 0); atomic_store(&audio_running, true);
    status("录音中  OK 发送"); xTaskNotifyGive(audio_task_handle);
}
static void handle_pair_offer(cJSON *offer) {
    if(state.page!=MT_PAIRING||pair_finished||!pair_nonce[0]||strcmp(str(offer,"type"),"pair_offer")||
       strcmp(str(offer,"nonce"),pair_nonce)||strcmp(str(offer,"deviceId"),device_id))return;
    cJSON *server=cJSON_GetObjectItem(offer,"server");
    pair_candidate=mt_config_enroll(device_config,server);
    if(!pair_candidate){status("添加信息无效或主机已满");render(NULL);return;}
    snprintf(pair_server_id,sizeof(pair_server_id),"%s",str(server,"id"));
    char body[180];snprintf(body,sizeof(body),"添加这台电脑？\n\n%s\n\n按 OK 确认\n长按 OK 取消",str(server,"name"));
    state.page=MT_PAIR_CONFIRM;status("确认添加主机");render(body);
}
static void handle_json(const char *data) {
    if (!data) return;
    cJSON *o = cJSON_Parse(data); if (!o) return;
    if(state.page==MT_PAIRING||state.page==MT_PAIR_CONFIRM){handle_pair_offer(o);cJSON_Delete(o);return;}
    const char *type = str(o, "type");
    if (!strcmp(type, "challenge")) {
        const char *challenge = str(o, "challenge"), *secret = targets[target_index].secret;
        unsigned char digest[32]; char proof[65];
        if (strlen(challenge) != 64 || mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),
            (const unsigned char *)secret, strlen(secret), (const unsigned char *)challenge, strlen(challenge), digest)) { cJSON_Delete(o); return; }
        for (int i = 0; i < 32; i++) snprintf(proof + i*2, 3, "%02x", digest[i]);
        cJSON *auth = message("auth"); cJSON_AddStringToObject(auth, "proof", proof); send_json(auth);
        status("正在绑定电脑"); render(NULL);
    } else if (!strcmp(type, "bound")) {
        state.bound = true;
        cJSON *sessions = cJSON_GetObjectItem(o, "sessions"); state.session_count = 0;
        cJSON *item;
        cJSON_ArrayForEach(item, sessions) {
            if (state.session_count >= MT_SESSION_MAX) break;
            mt_session_t *s = &state.sessions[state.session_count++];
            snprintf(s->id, sizeof(s->id), "%s", str(item, "id")); snprintf(s->name, sizeof(s->name), "%s", str(item, "name"));
        }
        state.selected = 0;
        if (!state.session_count) { status("没有可用会话"); render("请在电脑配置已有的 Codex 桌面会话"); }
        else if (state.session_count == 1) choose_session(); else show_sessions();
    } else if (!strcmp(type, "selected")) { status("就绪  OK 录音"); render("按 OK 开始说话\n\n上下翻阅内容\n长按上下切换会话"); }
    else if (!strcmp(type, "reply")) {
        if (state.page != MT_READING || strcmp(str(o, "sessionId"), state.sessions[state.selected].id)) { cJSON_Delete(o); return; }
        snprintf(reply, sizeof(reply), "%s", str(o, "text"));
        if (follow_reply && !state.recording) { status("就绪  OK 录音"); render(reply); }
        else { snprintf(pending_reply, sizeof(pending_reply), "%s", reply); status("有新回复  下翻查看"); render(NULL); }
    } else if (!strcmp(type, "state")) {
        const char *value = str(o, "state");
        if (!strcmp(value, "completed") && !strcmp(str(o, "sessionId"), submitted_session)) {
            cJSON *id = cJSON_GetObjectItem(o, "id");
            if (cJSON_IsNumber(id) && (uint32_t)id->valuedouble == recording_id) { state.submitting = false; submitted_session[0] = 0; }
        }
        if (strcmp(str(o, "sessionId"), state.sessions[state.selected].id)) { cJSON_Delete(o); return; }
        if (!strcmp(value, "recognizing")) { status("原生语音识别中"); render("语音已发送\n\n等待 Codex 原生语音处理"); }
        else if (!strcmp(value, "submitting")) { status("正在提交到会话"); render(NULL); }
        else if (!strcmp(value, "accepted")) { status("已接受，等待回复"); render(NULL); }
        else if (!strcmp(value, "submission_unknown")) { state.submitting = true; status("提交状态未知"); render("请在电脑上确认\n\n不会自动重发录音"); }
    } else if (!strcmp(type, "error")) {
        const char *session_id = str(o, "sessionId");
        if (session_id[0] && state.page == MT_READING && strcmp(session_id, state.sessions[state.selected].id)) {
            if (!strcmp(session_id, submitted_session) && strcmp(str(o, "code"), "submission_unknown")) { state.submitting = false; submitted_session[0] = 0; }
            cJSON_Delete(o); return;
        }
        atomic_store(&audio_submit, false); atomic_store(&audio_running, false); state.recording = false;
        bool unknown = !strcmp(str(o, "code"), "submission_unknown") || !strcmp(str(o, "code"), "input_cancelled_or_pending");
        state.submitting = unknown;
        status(unknown ? "请到电脑确认状态" : "发生错误，请重试");
        render(unknown ? "提交状态待确认\n\n不会自动重发录音" : "连接或语音处理失败\n\n请检查电脑桥接\n长按 OK 返回");
    }
    cJSON_Delete(o);
}
static void handle_key(int key, int action) {
    if (action == BSP_BTN_LONG && key == BSP_BTN_OK) {
        if (!disconnect_target()) return;
        manual_machine_selection=true;home_index=target_count?0:1;show_home();return;
    }
    if(state.page==MT_SETUP)return;
    if(state.page==MT_PAIRING)return;
    if(state.page==MT_PAIR_CONFIRM) {
        if(action!=BSP_BTN_CLICK||key!=BSP_BTN_OK||!pair_candidate)return;
        if(mt_config_save(pair_candidate)!=ESP_OK){status("保存失败，OK 重试");render(NULL);return;}
        cJSON_Delete(device_config);device_config=pair_candidate;pair_candidate=NULL;read_settings();
        cJSON *ack=message("pair_saved");cJSON_AddStringToObject(ack,"nonce",pair_nonce);cJSON_AddStringToObject(ack,"serverId",pair_server_id);send_json(ack);
        pair_finished=true;pair_deadline=0;pair_close_at=esp_timer_get_time()+2500000;state.page=MT_PAIRING;
        status("主机已保存");render("添加成功\n\n即将返回首页\n选择 Server list 连接");return;
    }
    if (state.recording) {
        if (key == BSP_BTN_OK && action == BSP_BTN_CLICK) {
            state.recording = false; state.submitting = true; atomic_store(&audio_submit, true); atomic_store(&audio_running, false);
            snprintf(submitted_session, sizeof(submitted_session), "%s", state.sessions[state.selected].id);
            status("正在上传语音"); render("录音已结束\n\n正在发送到电脑");
        }
        return;
    }
    int direction = key == BSP_BTN_UP ? -1 : 1;
    if (action == BSP_BTN_LONG && key != BSP_BTN_OK && state.page == MT_READING && state.session_count > 1) {
        state.selected = (state.selected + state.session_count + direction) % state.session_count; choose_session(); return;
    }
    if (action != BSP_BTN_CLICK) return;
    if(state.page==MT_HOME) {
        if(key!=BSP_BTN_OK){int first=target_count?0:1,count=target_count?3:2;home_index=first+(home_index-first+count+direction)%count;show_home();}
        else if(home_index==0){if(target_count)show_machines();else{status("暂无主机，请选择 Add server");render(NULL);}}
        else if(home_index==1)enter_pairing();else enter_config_upload();
    } else if (state.page == MT_MACHINES) {
        if (key == BSP_BTN_OK) { state.transport = MT_BLUETOOTH; show_transports(); }
        else if (key != BSP_BTN_OK) { target_index = (target_index + target_count + direction) % target_count; show_machines(); }
    } else if (state.page == MT_TRANSPORT) {
        if (key == BSP_BTN_OK) connect_target();
        else { state.transport = state.transport == MT_BLUETOOTH ? MT_WIFI : MT_BLUETOOTH; show_transports(); }
    } else if (state.page == MT_SESSIONS) {
        if (key == BSP_BTN_OK) choose_session();
        else { state.selected = (state.selected + state.session_count + direction) % state.session_count; show_sessions(); }
    } else if (key == BSP_BTN_OK) start_audio();
    else {
        if (key == BSP_BTN_UP) follow_reply = false;
        if (key == BSP_BTN_DOWN && pending_reply[0]) { follow_reply = true; pending_reply[0] = 0; status("就绪  OK 录音"); render(reply); }
        else if (bsp_lvgl_lock(100)) { mt_ui_scroll(direction); bsp_lvgl_unlock(); }
    }
}
void app_main(void) {
    device_config=mt_config_empty();if(!device_config)return;
    device_id=str(device_config,"deviceId");
    for (int i = 0; i < 4; i++) snprintf(boot_id + i*8, 9, "%08lx", (unsigned long)esp_random());
    events = xQueueCreate(16, sizeof(event_t)); audio_stopped = xSemaphoreCreateBinary();
    if (!events || !audio_stopped) return;
    ESP_ERROR_CHECK(bsp_display_init());
    if (!bsp_lvgl_init()) return;
    if (!bsp_lvgl_lock(1000)) return;
    mt_ui_init(!strcmp(str(device_config, "skin"), "reading")); bsp_lvgl_unlock();
    bsp_battery_init();state.transport=MT_BLUETOOTH;manual_machine_selection=true;home_index=1;show_home();
    /* The BSP initializes backlight PWM to zero; enable it after creating the UI. */
    bsp_display_backlight(80);
    ESP_ERROR_CHECK(bsp_button_init(key_event, NULL));
    audio_ok = bsp_audio_init() == ESP_OK && bsp_audio_set_format(16000, 16, 1) == ESP_OK;
    if (audio_ok && bsp_audio_sleep() != ESP_OK) audio_ok = false;
    if (audio_ok && xTaskCreate(audio_worker, "mt_audio", 4096, NULL, 5, &audio_task_handle) != pdPASS) audio_ok = false;
    /* Never erase NVS to conceal a partition or schema mismatch. */
    if (nvs_flash_init() != ESP_OK) { status("NVS 初始化失败"); render("请检查固件分区配置"); return; }
    ESP_ERROR_CHECK(esp_netif_init()); ESP_ERROR_CHECK(esp_event_loop_create_default());
    cJSON *loaded=mt_config_load();bool recovery=!loaded;
    if(loaded){cJSON_Delete(device_config);device_config=loaded;}
    if(!strcmp(str(device_config,"deviceId"),"mirtar-new")) {
        char id[40];snprintf(id,sizeof(id),"mirtar-%08lX%08lX",(unsigned long)esp_random(),(unsigned long)esp_random());
        cJSON_ReplaceItemInObjectCaseSensitive(device_config,"deviceId",cJSON_CreateString(id));
    }
    read_settings();home_index=target_count?0:1;show_home();
    if(recovery){status("旧配置需转换后重新导入");render(NULL);}
    printf("MirTar startup: heap=%u largest=%u, microphone_idle=off\n", (unsigned)esp_get_free_heap_size(),
        (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_8BIT));
    int64_t last_render = 0;
    for (;;) {
        event_t event;
        if (xQueueReceive(events, &event, pdMS_TO_TICKS(150)) == pdTRUE) {
            if (event.generation && event.generation != generation) { free(event.json); continue; }
            switch (event.kind) {
            case EV_KEY: handle_key(event.key, event.action); break;
            case EV_WIFI_ON:
                if (state.transport != MT_WIFI || manual_machine_selection || !wifi_started) break;
                state.wifi=true;wifi_deadline=0;wifi_attempt_active=false;wifi_retry_at=wifi_attempt_deadline=0;connect_websocket();break;
            case EV_WIFI_OFF:
                if (state.transport != MT_WIFI || manual_machine_selection || !wifi_started) break;
                if(!wifi_count)break;
                if (!event.action && !state.wifi && !wifi_attempt_active) break;
                if(state.wifi)wifi_deadline=esp_timer_get_time()+30000000;
                wifi_attempt_active = false;
                state.wifi = false; atomic_store(&audio_submit, false); atomic_store(&audio_running, false); mt_disconnect(&state);
                if (!event.action) wifi_index = (wifi_index + 1) % wifi_count;
                wifi_attempt_deadline = 0; wifi_retry_at = esp_timer_get_time() + 1500000;
                state.page = MT_CONNECTING; status("正在尝试预置 Wi-Fi"); render(NULL); break;
            case EV_WS_ON: {
                if(state.page==MT_PAIRING||state.page==MT_PAIR_CONFIRM) {
                    if(pair_finished)break;
                    cJSON_Delete(pair_candidate);pair_candidate=NULL;state.page=MT_PAIRING;
                    for(int i=0;i<4;i++)snprintf(pair_nonce+i*8,9,"%08lx",(unsigned long)esp_random());
                    cJSON *hello=message("pair_hello");cJSON_AddStringToObject(hello,"deviceId",device_id);cJSON_AddStringToObject(hello,"nonce",pair_nonce);send_json(hello);break;
                }
                state.connected = true;
                printf("MirTar link: mode=%s heap=%u largest=%u\n", state.transport == MT_BLUETOOTH ? "BLE" : "Wi-Fi",
                    (unsigned)esp_get_free_heap_size(), (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_8BIT));
                cJSON *o = message("hello"); cJSON_AddNumberToObject(o, "version", 1); cJSON_AddStringToObject(o, "deviceId", device_id); cJSON_AddStringToObject(o, "bootId", boot_id); send_json(o);
                status("正在校验电脑绑定"); render(NULL); break;
            }
            case EV_WS_OFF:
                if(state.page==MT_PAIRING||state.page==MT_PAIR_CONFIRM) {
                    if(!pair_finished){cJSON_Delete(pair_candidate);pair_candidate=NULL;pair_nonce[0]=0;state.page=MT_PAIRING;status("蓝牙断开，等待重新添加");render("请在电脑重试\n\n长按 OK 取消");}break;
                }
                atomic_store(&audio_submit, false); atomic_store(&audio_running, false); mt_disconnect(&state);
                if (!manual_machine_selection) { state.page = MT_CONNECTING; status("电脑连接断开，重试中"); render(NULL); }
                break;
            case EV_BLE_PIN: {
                char body[160]; snprintf(body, sizeof(body), "蓝牙配对码\n\n%06d\n\n请在 Windows 输入\n\n长按 OK 取消", event.key);
                status("等待 Windows 配对"); render(body); break;
            }
            case EV_JSON: handle_json(event.json); break;
            case EV_CONFIG:
                if(state.page!=MT_SETUP||!mt_portal_active())break;
                free(pending_config);pending_config=event.json;event.json=NULL;config_apply_at=esp_timer_get_time()+800000;break;
            case EV_AUDIO_DONE:
                if ((uint32_t)event.key != recording_id) break;
                state.recording = false;
                if (!event.action && state.page == MT_READING) { state.submitting = false; status("录音未提交"); render("录音失败或已取消\n\n单次最多 30 秒\n按 OK 重新录音"); }
                break;
            }
            free(event.json);
        }
        int64_t now = esp_timer_get_time();
        if(pending_config&&now>=config_apply_at) {
            cJSON *candidate=mt_config_parse(pending_config,strlen(pending_config)+1);free(pending_config);pending_config=NULL;
            if(!candidate||mt_config_save(candidate)!=ESP_OK){cJSON_Delete(candidate);mt_portal_status("error");status("保存失败，请重新上传");render(NULL);}
            else{cJSON_Delete(device_config);device_config=candidate;read_settings();mt_portal_snapshot(device_config);mt_portal_status("saved");portal_close_at=now+3000000;status("配置已保存，即将返回首页");render(NULL);}
        }
        if((portal_close_at&&now>=portal_close_at)||(pair_close_at&&now>=pair_close_at)||(pair_deadline&&now>=pair_deadline)) {
            if(disconnect_target()){manual_machine_selection=true;home_index=target_count?0:1;show_home();}
        }
        if(state.transport==MT_WIFI&&!manual_machine_selection&&!state.wifi&&wifi_deadline&&now>=wifi_deadline) {
            wifi_deadline=wifi_retry_at=wifi_attempt_deadline=0;wifi_attempt_active=false;manual_machine_selection=true;esp_wifi_disconnect();
            status("主机 Wi-Fi 连接失败");render("检查该主机的 Wi-Fi 和地址\n\n需要修改时返回首页\n选择 Add config-file\n\n长按 OK 返回");
        }
        if (state.transport == MT_WIFI && !manual_machine_selection && !state.wifi && wifi_attempt_deadline && now >= wifi_attempt_deadline) {
            wifi_attempt_deadline = 0; esp_wifi_disconnect();
            /* A missed disconnect callback must not strand network selection. */
            post((event_t){ .kind = EV_WIFI_OFF, .generation=generation });
        }
        if (state.transport == MT_WIFI && !manual_machine_selection && !state.wifi && wifi_retry_at && now >= wifi_retry_at) {
            wifi_retry_at = 0;
            wifi_attempt_active = true;
            esp_wifi_set_config(WIFI_IF_STA, &wifi_networks[wifi_index]);
            if (esp_wifi_connect() != ESP_OK) post((event_t){ .kind = EV_WIFI_OFF, .generation=generation });
            else wifi_attempt_deadline = now + 15000000;
        }
        if (state.recording && esp_timer_get_time() - last_render > 250000) {
            if (bsp_lvgl_lock(100)) { mt_ui_recording(atomic_load(&audio_seconds), atomic_load(&audio_level)); bsp_lvgl_unlock(); }
            last_render = esp_timer_get_time();
        }
    }
}
