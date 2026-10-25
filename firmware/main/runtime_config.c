#include "runtime_config.h"
#include <string.h>
#include <stdlib.h>
#include <ctype.h>
#include "nvs.h"

static const char defaults[] = "{\"version\":1,\"deviceId\":\"mirtar-card-1\",\"skin\":\"reading\",\"allowLanPlaintext\":true,\"wifiNetworks\":[],\"targets\":[]}";
cJSON *mt_config_empty(void) { return cJSON_Parse(defaults); }
cJSON *mt_config_parse(const char *json, size_t length) {
    if (!json || !length || length > MT_CONFIG_LIMIT + 1 || json[length - 1] != 0) return NULL;
    for (size_t i = 0; i + 1 < length; i++) {
        if (!json[i]) return NULL;
        if (json[i] == '\\') {
            if (i + 5 < length && !memcmp(json + i + 1, "u0000", 5)) return NULL;
            i++;
        }
    }
    return cJSON_ParseWithLengthOpts(json, length, NULL, true);
}
static const char *field(const cJSON *o, const char *name) {
    const cJSON *v = cJSON_GetObjectItemCaseSensitive(o, name);
    return cJSON_IsString(v) ? v->valuestring : NULL;
}
static bool identifier(const char *value, size_t max) {
    if (!value || !*value || strlen(value) > max) return false;
    for (const unsigned char *p = (const unsigned char *)value; *p; p++)
        if (!(isalnum(*p) || *p == '_' || *p == '-')) return false;
    return true;
}
static bool network_valid(const cJSON *network) {
    const char *ssid = field(network, "ssid"), *password = field(network, "password");
    return ssid && *ssid && strlen(ssid) <= 32 && password &&
        (!*password || (strlen(password) >= 8 && strlen(password) <= 63));
}
bool mt_config_valid(const cJSON *config) {
    const cJSON *version = cJSON_GetObjectItemCaseSensitive(config, "version");
    const cJSON *networks = cJSON_GetObjectItemCaseSensitive(config, "wifiNetworks");
    const cJSON *targets = cJSON_GetObjectItemCaseSensitive(config, "targets");
    if (!cJSON_IsObject(config) || !cJSON_IsNumber(version) || version->valuedouble != 1 ||
        !identifier(field(config, "deviceId"), 40) ||
        cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(config, "template")) ||
        !cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(config, "allowLanPlaintext")) ||
        !cJSON_IsArray(networks) || cJSON_GetArraySize(networks) > 8 ||
        !cJSON_IsArray(targets) || cJSON_GetArraySize(targets) > 4) return false;
    const cJSON *item;
    cJSON_ArrayForEach(item, networks) if (!network_valid(item)) return false;
    cJSON_ArrayForEach(item, targets) {
        const char *name = field(item, "name"), *url = field(item, "url"), *secret = field(item, "secret");
        const char *bt = field(item, "bluetoothName");
        if (!name || !*name || strlen(name) > 40 || !url || strncmp(url, "ws://", 5) ||
            strlen(url) >= 200 || strchr(url, '@') || !secret || strlen(secret) < 32 || strlen(secret) > 128 ||
            !strncmp(secret, "REPLACE_WITH_", 13) || !identifier(bt ? bt : name, 20)) return false;
        for (const unsigned char *p = (const unsigned char *)url; *p; p++) if (*p <= 32 || *p == 127) return false;
    }
    char *text = cJSON_PrintUnformatted(config);
    bool ok = text && strlen(text) <= MT_CONFIG_LIMIT;
    free(text); return ok;
}
cJSON *mt_config_load(void) {
    nvs_handle_t handle;
    esp_err_t result = nvs_open("mirtar", NVS_READONLY, &handle);
    if (result == ESP_ERR_NVS_NOT_FOUND) return cJSON_Parse(defaults);
    if (result != ESP_OK) return NULL;
    size_t bytes = 0;
    result = nvs_get_blob(handle, "config", NULL, &bytes);
    if (result == ESP_ERR_NVS_NOT_FOUND) { nvs_close(handle); return cJSON_Parse(defaults); }
    if (result != ESP_OK || bytes < 2 || bytes > MT_CONFIG_LIMIT + 1) { nvs_close(handle); return NULL; }
    char *text = malloc(bytes);
    if (!text) { nvs_close(handle); return NULL; }
    result = nvs_get_blob(handle, "config", text, &bytes); nvs_close(handle);
    cJSON *config = result == ESP_OK ? mt_config_parse(text, bytes) : NULL;
    free(text);
    if (!mt_config_valid(config)) { cJSON_Delete(config); return NULL; }
    return config;
}
esp_err_t mt_config_save(const cJSON *config) {
    if (!mt_config_valid(config)) return ESP_ERR_INVALID_ARG;
    char *text = cJSON_PrintUnformatted(config);
    if (!text) return ESP_ERR_NO_MEM;
    nvs_handle_t handle;
    esp_err_t result = nvs_open("mirtar", NVS_READWRITE, &handle);
    if (result == ESP_OK) {
        result = nvs_set_blob(handle, "config", text, strlen(text) + 1);
        if (result == ESP_OK) result = nvs_commit(handle);
        nvs_close(handle);
    }
    memset(text, 0, strlen(text)); free(text); return result;
}
cJSON *mt_config_merge(const cJSON *base, const cJSON *request) {
    const char *mode = field(request, "mode");
    bool replace_networks = (!mode || !strcmp(mode, "wifi")) &&
        cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(request, "replaceNetworks"));
    const cJSON *imported = cJSON_GetObjectItemCaseSensitive(request, "deviceConfig");
    cJSON *merged = cJSON_Duplicate(base, true);
    if (imported) {
        if (!mt_config_valid(imported)) { cJSON_Delete(merged); return NULL; }
        const char *keys[] = {"version", "deviceId", "skin", "allowLanPlaintext", "targets"};
        for (unsigned i = 0; i < sizeof(keys) / sizeof(keys[0]); i++) {
            const cJSON *value = cJSON_GetObjectItemCaseSensitive(imported, keys[i]);
            if (!value) continue;
            cJSON *copy = cJSON_Duplicate(value, true);
            if (!copy) { cJSON_Delete(merged); return NULL; }
            cJSON_DeleteItemFromObjectCaseSensitive(merged, keys[i]);
            if (!cJSON_AddItemToObject(merged, keys[i], copy)) { cJSON_Delete(copy); cJSON_Delete(merged); return NULL; }
        }
        cJSON *saved = cJSON_GetObjectItemCaseSensitive(merged, "wifiNetworks");
        const cJSON *profile;
        cJSON_ArrayForEach(profile, cJSON_GetObjectItemCaseSensitive(imported, "wifiNetworks")) {
            if (replace_networks) continue;
            for (int i = cJSON_GetArraySize(saved) - 1; i >= 0; i--)
                if (!strcmp(field(cJSON_GetArrayItem(saved, i), "ssid"), field(profile, "ssid"))) cJSON_DeleteItemFromArray(saved, i);
            cJSON *copy = cJSON_Duplicate(profile, true);
            if (!copy || cJSON_GetArraySize(saved) >= 8 || !cJSON_AddItemToArray(saved, copy)) { cJSON_Delete(copy); cJSON_Delete(merged); return NULL; }
        }
    }
    if (!mt_config_valid(merged)) { cJSON_Delete(merged); return NULL; }
    if (mode && !strcmp(mode, "bluetooth")) {
        if (imported && cJSON_GetArraySize(cJSON_GetObjectItemCaseSensitive(merged, "targets")) > 0) return merged;
        cJSON_Delete(merged); return NULL;
    }
    if (mode && strcmp(mode, "wifi")) { cJSON_Delete(merged); return NULL; }
    const cJSON *network = cJSON_GetObjectItemCaseSensitive(request, "wifi");
    if (!network_valid(network)) { cJSON_Delete(merged); return NULL; }
    cJSON *list = cJSON_GetObjectItemCaseSensitive(merged, "wifiNetworks");
    if (replace_networks) {
        cJSON *empty = cJSON_CreateArray();
        if (!empty || !cJSON_ReplaceItemInObjectCaseSensitive(merged, "wifiNetworks", empty)) { cJSON_Delete(empty); cJSON_Delete(merged); return NULL; }
        list = empty;
    }
    const char *ssid = field(network, "ssid");
    for (int i = cJSON_GetArraySize(list) - 1; i >= 0; i--)
        if (!strcmp(field(cJSON_GetArrayItem(list, i), "ssid"), ssid)) cJSON_DeleteItemFromArray(list, i);
    /* Try the newly entered network first; preserve the other saved profiles. */
    cJSON *copy = cJSON_Duplicate(network, true);
    if (!copy || cJSON_GetArraySize(list) >= 8) { cJSON_Delete(copy); cJSON_Delete(merged); return NULL; }
    cJSON_InsertItemInArray(list, 0, copy);
    if (!mt_config_valid(merged)) { cJSON_Delete(merged); return NULL; }
    return merged;
}
