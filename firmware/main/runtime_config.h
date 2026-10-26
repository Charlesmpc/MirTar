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
/* Import by stable server ID; other servers keep their own Wi-Fi. */
cJSON *mt_config_import(const cJSON *base, const cJSON *incoming);
const cJSON *mt_config_server_wifi(const cJSON *config, int index);
cJSON *mt_config_enroll(const cJSON *base, const cJSON *server);
/* Pure copy: remove one whole server object, never mutate the source. */
cJSON *mt_config_remove_server(const cJSON *base, const char *server_id);
