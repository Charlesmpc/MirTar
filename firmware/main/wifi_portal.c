#include "wifi_portal.h"
#include "runtime_config.h"
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "esp_http_server.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "esp_random.h"
#include "lwip/sockets.h"

extern const char portal_html_start[] asm("_binary_portal_html_start");
extern const char portal_html_end[] asm("_binary_portal_html_end");
static httpd_handle_t server;
static esp_netif_t *ap;
static SemaphoreHandle_t lock;
static mt_portal_submit_t receiver;
static char ssid[32], password[13], token[33], snapshot[MT_CONFIG_LIMIT + 1], phase[24];
bool mt_portal_active(void) { return server != NULL; }
const char *mt_portal_ssid(void) { return ssid; }
const char *mt_portal_password(void) { return password; }
void mt_portal_status(const char *value) {
    if (lock && xSemaphoreTake(lock, portMAX_DELAY)) { snprintf(phase, sizeof(phase), "%s", value); xSemaphoreGive(lock); }
}
void mt_portal_snapshot(const cJSON *config) {
    char *text = cJSON_PrintUnformatted(config);
    if (text && lock && xSemaphoreTake(lock, portMAX_DELAY)) {
        snprintf(snapshot, sizeof(snapshot), "%s", text); xSemaphoreGive(lock);
    }
    free(text);
}
static bool local_request(httpd_req_t *request) {
    struct sockaddr_in peer, local; socklen_t length = sizeof(peer);
    int socket = httpd_req_to_sockfd(request);
    if (getpeername(socket, (struct sockaddr *)&peer, &length) || peer.sin_family != AF_INET ||
        (ntohl(peer.sin_addr.s_addr) & 0xffffff00U) != 0xc0a80400U) return false;
    length = sizeof(local);
    if (getsockname(socket, (struct sockaddr *)&local, &length) || ntohl(local.sin_addr.s_addr) != 0xc0a80401U) return false;
    char host[40];
    return httpd_req_get_hdr_value_str(request, "Host", host, sizeof(host)) == ESP_OK &&
        (!strcmp(host, "192.168.4.1") || !strcmp(host, "192.168.4.1:80"));
}
static esp_err_t json_response(httpd_req_t *request, const char *status, const char *body) {
    httpd_resp_set_status(request, status); httpd_resp_set_type(request, "application/json");
    httpd_resp_set_hdr(request, "Cache-Control", "no-store");
    httpd_resp_set_hdr(request, "X-Content-Type-Options", "nosniff");
    return httpd_resp_send(request, body, HTTPD_RESP_USE_STRLEN);
}
static esp_err_t home(httpd_req_t *request) {
    if (!local_request(request)) return json_response(request, "403 Forbidden", "{\"error\":\"local_only\"}");
    httpd_resp_set_type(request, "text/html; charset=utf-8");
    httpd_resp_set_hdr(request, "Cache-Control", "no-store");
    httpd_resp_set_hdr(request, "X-Frame-Options", "DENY");
    httpd_resp_set_hdr(request, "Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'");
    return httpd_resp_send(request, portal_html_start, portal_html_end - portal_html_start - 1);
}
static esp_err_t get_status(httpd_req_t *request) {
    if (!local_request(request)) return json_response(request, "403 Forbidden", "{\"error\":\"local_only\"}");
    cJSON *o = cJSON_CreateObject();
    if (!o) return ESP_ERR_NO_MEM;
    xSemaphoreTake(lock, portMAX_DELAY);
    cJSON_AddStringToObject(o, "csrf", token); cJSON_AddStringToObject(o, "phase", phase);
    cJSON *config = cJSON_Parse(snapshot);
    cJSON_AddNumberToObject(o, "servers", cJSON_GetArraySize(cJSON_GetObjectItemCaseSensitive(config, "servers")));
    const cJSON *id=cJSON_GetObjectItemCaseSensitive(config,"deviceId");
    cJSON_AddStringToObject(o,"deviceId",cJSON_IsString(id)?id->valuestring:"");
    cJSON_Delete(config); xSemaphoreGive(lock);
    char *text = cJSON_PrintUnformatted(o); cJSON_Delete(o);
    if (!text) return ESP_ERR_NO_MEM;
    esp_err_t result = json_response(request, "200 OK", text); free(text); return result;
}
static esp_err_t configure(httpd_req_t *request) {
    char proof[40], content_type[48], origin[48];
    if (!local_request(request) || httpd_req_get_hdr_value_str(request, "X-MirTar-Setup", proof, sizeof(proof)) != ESP_OK || strcmp(proof, token))
        return json_response(request, "403 Forbidden", "{\"error\":\"setup_token\"}");
    size_t origin_length = httpd_req_get_hdr_value_len(request, "Origin");
    if (origin_length && (httpd_req_get_hdr_value_str(request, "Origin", origin, sizeof(origin)) != ESP_OK || strcmp(origin, "http://192.168.4.1")))
        return json_response(request, "403 Forbidden", "{\"error\":\"origin\"}");
    if (httpd_req_get_hdr_value_str(request, "Content-Type", content_type, sizeof(content_type)) != ESP_OK || strncmp(content_type, "application/json", 16))
        return json_response(request, "415 Unsupported Media Type", "{\"error\":\"json_required\"}");
    if (request->content_len < 2 || request->content_len > MT_CONFIG_LIMIT)
        return json_response(request, "413 Payload Too Large", "{\"error\":\"size\"}");
    char *body = malloc(request->content_len + 1);
    if (!body) return ESP_ERR_NO_MEM;
    size_t used = 0;
    while (used < request->content_len) {
        int bytes = httpd_req_recv(request, body + used, request->content_len - used);
        if (bytes <= 0) { free(body); return ESP_FAIL; }
        used += bytes;
    }
    body[used] = 0;
    cJSON *input = mt_config_parse(body, used + 1); memset(body, 0, used); free(body);
    xSemaphoreTake(lock, portMAX_DELAY);
    cJSON *base = cJSON_Parse(snapshot);
    bool busy = !strcmp(phase, "saving") || !strcmp(phase, "saved");
    xSemaphoreGive(lock);
    cJSON *merged = input && !busy ? mt_config_import(base, input) : NULL;
    cJSON_Delete(input); cJSON_Delete(base);
    if (!merged) return json_response(request, busy ? "409 Conflict" : "400 Bad Request", busy ? "{\"error\":\"busy\"}" : "{\"error\":\"invalid_config\"}");
    char *text = cJSON_PrintUnformatted(merged); cJSON_Delete(merged);
    mt_portal_status("saving");
    if (!text || !receiver(text)) {
        free(text); mt_portal_status("error");
        return json_response(request, "503 Service Unavailable", "{\"error\":\"retry\"}");
    }
    return json_response(request, "202 Accepted", "{\"accepted\":true}");
}
bool mt_portal_start(const cJSON *config, mt_portal_submit_t submit) {
    if (server) return true;
    if (!lock) lock = xSemaphoreCreateMutex();
    if (!lock) return false;
    receiver = submit; mt_portal_snapshot(config); mt_portal_status("ready");
    uint32_t random = esp_random(); snprintf(ssid, sizeof(ssid), "MirTar-Setup-%06lX", (unsigned long)(random & 0xffffff));
    snprintf(password, sizeof(password), "%08lX%04lX", (unsigned long)esp_random(), (unsigned long)(esp_random() & 0xffff));
    for (int i = 0; i < 4; i++) snprintf(token + i * 8, 9, "%08lx", (unsigned long)esp_random());
    ap = esp_netif_create_default_wifi_ap();
    if (!ap) return false;
    esp_netif_ip_info_t ip = {0};
    IP4_ADDR(&ip.ip, 192, 168, 4, 1); IP4_ADDR(&ip.gw, 192, 168, 4, 1); IP4_ADDR(&ip.netmask, 255, 255, 255, 0);
    esp_netif_dhcps_stop(ap);
    if (esp_netif_set_ip_info(ap, &ip) != ESP_OK || esp_netif_dhcps_start(ap) != ESP_OK) { mt_portal_stop(); return false; }
    wifi_config_t wifi = {0};
    memcpy(wifi.ap.ssid, ssid, strlen(ssid)); wifi.ap.ssid_len = strlen(ssid);
    memcpy(wifi.ap.password, password, strlen(password));
    wifi.ap.channel = 1; wifi.ap.max_connection = 2; wifi.ap.authmode = WIFI_AUTH_WPA2_PSK;
    if (esp_wifi_set_mode(WIFI_MODE_AP) != ESP_OK || esp_wifi_set_config(WIFI_IF_AP, &wifi) != ESP_OK) { mt_portal_stop(); return false; }
    httpd_config_t http = HTTPD_DEFAULT_CONFIG();
    http.stack_size = 6144; http.max_open_sockets = 3; http.lru_purge_enable = true;
    http.recv_wait_timeout = 4; http.send_wait_timeout = 4;
    if (httpd_start(&server, &http) != ESP_OK) { mt_portal_stop(); return false; }
    const httpd_uri_t routes[] = {
        { .uri="/", .method=HTTP_GET, .handler=home },
        { .uri="/api/status", .method=HTTP_GET, .handler=get_status },
        { .uri="/api/config", .method=HTTP_POST, .handler=configure }
    };
    for (unsigned i = 0; i < sizeof(routes) / sizeof(routes[0]); i++)
        if (httpd_register_uri_handler(server, &routes[i]) != ESP_OK) { mt_portal_stop(); return false; }
    return true;
}
void mt_portal_stop(void) {
    if (server) { httpd_stop(server); server = NULL; }
    if (ap) { esp_wifi_set_mode(WIFI_MODE_STA); esp_netif_destroy_default_wifi(ap); ap = NULL; }
    memset(password, 0, sizeof(password)); memset(token, 0, sizeof(token)); memset(snapshot, 0, sizeof(snapshot));
}
