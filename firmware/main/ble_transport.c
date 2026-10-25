#include "ble_transport.h"
#include <string.h>
#include <stdio.h>
#include <stdatomic.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "host/ble_hs.h"
#include "host/ble_sm.h"
#include "host/ble_store.h"
#include "host/util/util.h"
#include "services/gap/ble_svc_gap.h"
#include "services/gatt/ble_svc_gatt.h"

// UUID bytes are little endian, matching bridge/src/transport/ble-framing.ts.
#define MT_UUID(n) BLE_UUID128_INIT(0xb1,0x7a,0x5c,0xe3,0x78,0x35,0x18,0x8c,0x62,0x4c,0xc1,0x4d,n,0x00,0x9d,0x9a)
static const ble_uuid128_t service_uuid = MT_UUID(1), rx_uuid = MT_UUID(2), tx_uuid = MT_UUID(3);
static uint16_t tx_handle;
static atomic_uint connection = BLE_HS_CONN_HANDLE_NONE;
static atomic_bool enabled, synced, ready;
static bool initialized, subscribed;
static uint8_t own_address, tx_sequence, rx_sequence;
static int expected_sequence = -1;
static char name[29], rx_buffer[8193];
static size_t rx_used, rx_size;
static int64_t rx_deadline;
static uint32_t current_generation;
static mt_ble_callback_t notify;
static SemaphoreHandle_t send_lock;
void ble_store_config_init(void);
static int gap_event(struct ble_gap_event *, void *);

static void advertise(void) {
    if (!enabled || !synced || atomic_load(&connection) != BLE_HS_CONN_HANDLE_NONE) return;
    struct ble_hs_adv_fields fields = {0};
    fields.flags = BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP;
    fields.uuids128 = (ble_uuid128_t *)&service_uuid; fields.num_uuids128 = 1; fields.uuids128_is_complete = 1;
    if (ble_gap_adv_set_fields(&fields)) return;
    struct ble_hs_adv_fields scan = {0};
    scan.name = (const uint8_t *)name; scan.name_len = strlen(name); scan.name_is_complete = 1;
    if (ble_gap_adv_rsp_set_fields(&scan)) return;
    struct ble_gap_adv_params params = {0};
    params.conn_mode = BLE_GAP_CONN_MODE_UND; params.disc_mode = BLE_GAP_DISC_MODE_GEN;
    ble_gap_adv_start(own_address, NULL, BLE_HS_FOREVER, &params, gap_event, NULL);
}
static bool secure(void) {
    struct ble_gap_conn_desc desc;
    return !ble_gap_conn_find(atomic_load(&connection), &desc) && desc.sec_state.encrypted && desc.sec_state.authenticated;
}
static void maybe_ready(void) {
    if (enabled && subscribed && secure() && !atomic_exchange(&ready, true))
        notify(MT_BLE_ON, current_generation, NULL, 0);
}
static int access_value(uint16_t conn, uint16_t attr, struct ble_gatt_access_ctxt *ctx, void *arg) {
    (void)attr; (void)arg;
    if (!enabled || conn != atomic_load(&connection) || !secure()) return BLE_ATT_ERR_INSUFFICIENT_AUTHEN;
    if (ctx->op != BLE_GATT_ACCESS_OP_WRITE_CHR) return BLE_ATT_ERR_READ_NOT_PERMITTED;
    uint8_t packet[512]; uint16_t length = OS_MBUF_PKTLEN(ctx->om);
    if (length < 7 || length > sizeof(packet) || ble_hs_mbuf_to_flat(ctx->om, packet, sizeof(packet), NULL)) return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
    size_t offset = packet[2] | packet[3] << 8, total = packet[4] | packet[5] << 8;
    if (packet[0] != 0 || !total || total > 8192 || offset + length - 6 > total) return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
    if (!offset) {
        if (rx_used || (expected_sequence >= 0 && packet[1] != expected_sequence)) return BLE_ATT_ERR_UNLIKELY;
        rx_sequence = packet[1]; rx_size = total; rx_deadline = esp_timer_get_time() + 5000000;
    }
    if (offset != rx_used || total != rx_size || packet[1] != rx_sequence || esp_timer_get_time() > rx_deadline) return BLE_ATT_ERR_UNLIKELY;
    memcpy(rx_buffer + offset, packet + 6, length - 6); rx_used += length - 6;
    if (rx_used == rx_size) {
        rx_buffer[rx_used] = 0; expected_sequence = (rx_sequence + 1) & 255; rx_used = 0;
        notify(MT_BLE_JSON, current_generation, rx_buffer, 0);
    }
    return 0;
}
static const struct ble_gatt_svc_def services[] = {
    {.type = BLE_GATT_SVC_TYPE_PRIMARY, .uuid = &service_uuid.u,
     .characteristics = (struct ble_gatt_chr_def[]) {
        {.uuid = &rx_uuid.u, .access_cb = access_value, .flags = BLE_GATT_CHR_F_WRITE | BLE_GATT_CHR_F_WRITE_ENC | BLE_GATT_CHR_F_WRITE_AUTHEN},
        {.uuid = &tx_uuid.u, .access_cb = access_value, .val_handle = &tx_handle,
         .flags = BLE_GATT_CHR_F_NOTIFY | BLE_GATT_CHR_F_NOTIFY_INDICATE_ENC | BLE_GATT_CHR_F_NOTIFY_INDICATE_AUTHEN},
        {0}}}, {0}
};
static int gap_event(struct ble_gap_event *event, void *arg) {
    (void)arg;
    switch (event->type) {
    case BLE_GAP_EVENT_CONNECT:
        if (event->connect.status) { advertise(); break; }
        if (!enabled) { ble_gap_terminate(event->connect.conn_handle, BLE_ERR_REM_USER_CONN_TERM); break; }
        atomic_store(&connection, event->connect.conn_handle); subscribed = false;
        rx_used = 0; expected_sequence = -1; tx_sequence = 0;
        { struct ble_gap_upd_params p = {.itvl_min=6,.itvl_max=12,.latency=0,.supervision_timeout=400,.min_ce_len=0,.max_ce_len=0};
          ble_gap_update_params(event->connect.conn_handle, &p); }
        break;
    case BLE_GAP_EVENT_DISCONNECT:
        atomic_store(&connection, BLE_HS_CONN_HANDLE_NONE); atomic_store(&ready, false); subscribed = false;
        rx_used = 0; expected_sequence = -1;
        if (enabled) { notify(MT_BLE_OFF, current_generation, NULL, 0); advertise(); }
        break;
    case BLE_GAP_EVENT_SUBSCRIBE:
        if (event->subscribe.attr_handle == tx_handle) { subscribed = event->subscribe.cur_notify; maybe_ready(); }
        break;
    case BLE_GAP_EVENT_ENC_CHANGE:
        if (!event->enc_change.status) maybe_ready();
        else ble_gap_terminate(event->enc_change.conn_handle, BLE_ERR_AUTH_FAIL);
        break;
    case BLE_GAP_EVENT_PASSKEY_ACTION:
        if (event->passkey.params.action == BLE_SM_IOACT_DISP) {
            struct ble_sm_io io = {.action = BLE_SM_IOACT_DISP, .passkey = esp_random() % 1000000};
            notify(MT_BLE_PIN, current_generation, NULL, io.passkey);
            ble_sm_inject_io(event->passkey.conn_handle, &io);
        }
        break;
    // Do not silently delete an existing bond when an unknown peer asks to pair again.
    case BLE_GAP_EVENT_REPEAT_PAIRING: return BLE_GAP_REPEAT_PAIRING_IGNORE;
    default: break;
    }
    return 0;
}
static void host_sync(void) {
    if (ble_hs_util_ensure_addr(0) || ble_hs_id_infer_auto(0, &own_address)) return;
    atomic_store(&synced, true); advertise();
}
static void host_task(void *arg) { (void)arg; nimble_port_run(); nimble_port_freertos_deinit(); }
bool mt_ble_start(const char *host_name, uint32_t generation, mt_ble_callback_t callback) {
    mt_ble_stop();
    if (!host_name || !host_name[0] || strlen(host_name) > 20) return false;
    current_generation = generation; notify = callback;
    snprintf(name, sizeof(name), "MirTar-%s", host_name);
    atomic_store(&enabled, true);
    if (!initialized) {
        send_lock = xSemaphoreCreateMutex(); if (!send_lock || nimble_port_init() != ESP_OK) { enabled = false; return false; }
        ble_svc_gap_init(); ble_svc_gatt_init();
        ble_hs_cfg.sync_cb = host_sync;
        ble_hs_cfg.sm_io_cap = BLE_HS_IO_DISPLAY_ONLY;
        ble_hs_cfg.sm_bonding = 1; ble_hs_cfg.sm_mitm = 1; ble_hs_cfg.sm_sc = 1;
        ble_hs_cfg.sm_our_key_dist = BLE_SM_PAIR_KEY_DIST_ENC | BLE_SM_PAIR_KEY_DIST_ID;
        ble_hs_cfg.sm_their_key_dist = BLE_SM_PAIR_KEY_DIST_ENC | BLE_SM_PAIR_KEY_DIST_ID;
        ble_hs_cfg.store_status_cb = ble_store_util_status_rr;
        ble_store_config_init();
        if (ble_gatts_count_cfg(services) || ble_gatts_add_svcs(services)) { enabled = false; return false; }
        ble_att_set_preferred_mtu(247);
        initialized = true; nimble_port_freertos_init(host_task);
    } else advertise();
    return true;
}
void mt_ble_stop(void) {
    atomic_store(&enabled, false); atomic_store(&ready, false);
    if (!initialized) return;
    ble_gap_adv_stop();
    unsigned conn = atomic_load(&connection);
    if (conn != BLE_HS_CONN_HANDLE_NONE) ble_gap_terminate(conn, BLE_ERR_REM_USER_CONN_TERM);
    // Switching transports must free host/controller heap on this no-PSRAM chip.
    if (nimble_port_stop() == 0 && nimble_port_deinit() == ESP_OK) {
        initialized = false; atomic_store(&synced, false);
        atomic_store(&connection, BLE_HS_CONN_HANDLE_NONE);
        if (send_lock) { vSemaphoreDelete(send_lock); send_lock = NULL; }
    }
}
bool mt_ble_send(const void *data, size_t size, bool binary) {
    if (!size || size > 8192 || !atomic_load(&ready) || xSemaphoreTake(send_lock, pdMS_TO_TICKS(1200)) != pdTRUE) return false;
    unsigned conn = atomic_load(&connection); uint8_t id = tx_sequence++;
    int value_size = ble_att_mtu(conn) - 3; if (value_size > 244) value_size = 244;
    bool ok = value_size >= 20;
    for (size_t offset = 0; offset < size && ok;) {
        uint8_t packet[244]; size_t count = size - offset;
        if (count > value_size - 6) count = value_size - 6;
        packet[0] = binary ? 1 : 0; packet[1] = id;
        packet[2] = offset; packet[3] = offset >> 8; packet[4] = size; packet[5] = size >> 8;
        memcpy(packet + 6, (const uint8_t *)data + offset, count);
        int64_t deadline = esp_timer_get_time() + 500000;
        int rc;
        do {
            struct os_mbuf *buffer = ble_hs_mbuf_from_flat(packet, count + 6);
            rc = buffer ? ble_gatts_notify_custom(conn, tx_handle, buffer) : BLE_HS_ENOMEM;
            if (!rc) break;
            if (rc != BLE_HS_ENOMEM && rc != BLE_HS_EBUSY) break;
            vTaskDelay(pdMS_TO_TICKS(2));
        } while (atomic_load(&ready) && esp_timer_get_time() < deadline);
        ok = !rc && atomic_load(&ready); offset += count;
    }
    xSemaphoreGive(send_lock);
    // Never continue with a hole in the audio stream or a partial control frame.
    if (!ok) { ble_gap_terminate(conn, BLE_ERR_REM_USER_CONN_TERM); }
    return ok;
}
