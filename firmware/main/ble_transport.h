#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
typedef enum { MT_BLE_ON, MT_BLE_OFF, MT_BLE_JSON, MT_BLE_PIN } mt_ble_event_t;
typedef void (*mt_ble_callback_t)(mt_ble_event_t, uint32_t generation, const char *json, unsigned pin);
bool mt_ble_start(const char *host_name, uint32_t generation, mt_ble_callback_t callback);
void mt_ble_stop(void);
bool mt_ble_send(const void *data, size_t size, bool binary);
// Explicit physical confirmation is required by the caller. Clears BLE storage only.
bool mt_ble_reset_bonds(void);
