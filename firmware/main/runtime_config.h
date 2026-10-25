#pragma once
#include <stdbool.h>
#include "cJSON.h"
#include "esp_err.h"
#define MT_CONFIG_LIMIT 4096
cJSON *mt_config_parse(const char *json, size_t length);
/* Defaults contain no network, computer or shared binding credential. */
cJSON *mt_config_load(void);
cJSON *mt_config_empty(void);
bool mt_config_valid(const cJSON *config);
esp_err_t mt_config_save(const cJSON *config);
/* Merge the portal's optional imported config and one Wi-Fi profile. */
cJSON *mt_config_merge(const cJSON *base, const cJSON *request);
