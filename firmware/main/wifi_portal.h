#pragma once
#include <stdbool.h>
#include "cJSON.h"
typedef bool (*mt_portal_submit_t)(char *owned_json);
/* Wi-Fi driver must be initialized, but need not be started. */
bool mt_portal_start(const cJSON *config, mt_portal_submit_t submit);
void mt_portal_stop(void);
bool mt_portal_active(void);
const char *mt_portal_ssid(void);
const char *mt_portal_password(void);
void mt_portal_status(const char *phase);
void mt_portal_snapshot(const cJSON *config);
