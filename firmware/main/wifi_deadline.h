#pragma once
#include <stdbool.h>
#include <stdint.h>
#include <string.h>
#define MT_WIFI_SETUP_TIMEOUT_US (30LL * 1000000)
static inline int64_t mt_wifi_deadline(int64_t now) { return now + MT_WIFI_SETUP_TIMEOUT_US; }
static inline bool mt_wifi_setup_due(bool wifi_mode, bool choosing_computer, bool has_ip, int64_t deadline, int64_t now) {
    return wifi_mode && !choosing_computer && !has_ip && deadline > 0 && now >= deadline;
}
static inline bool mt_wifi_ssid_matches(const uint8_t actual[33], const uint8_t expected[32]) {
    size_t a = 0, b = 0;
    while (a < 33 && actual[a]) a++;
    while (b < 32 && expected[b]) b++;
    return a == b && !memcmp(actual, expected, b);
}
