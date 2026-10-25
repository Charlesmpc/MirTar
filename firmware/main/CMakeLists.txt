idf_component_register(SRCS "main.c" "ui.c" "state.c" "ble_transport.c" "runtime_config.c" "wifi_portal.c" "../assets/mirtar_font_16.c"
    INCLUDE_DIRS "." "${CMAKE_CURRENT_BINARY_DIR}"
    REQUIRES bsp bt esp_wifi esp_netif esp_event nvs_flash esp_websocket_client esp_http_server esp_app_format json mbedtls esp_timer
    EMBED_TXTFILES "portal.html")
