if(NOT DEFINED ENV{MIRTAR_DEVICE_CONFIG})
    set(MIRTAR_CONFIG "${CMAKE_CURRENT_LIST_DIR}/../../.private/device.config.json")
else()
    set(MIRTAR_CONFIG "$ENV{MIRTAR_DEVICE_CONFIG}")
endif()
set(MIRTAR_GENERATED "${CMAKE_CURRENT_BINARY_DIR}/device_config.h")
execute_process(COMMAND "${PYTHON}" "${CMAKE_CURRENT_LIST_DIR}/../../tools/generate_config.py"
    "${MIRTAR_CONFIG}" "${MIRTAR_GENERATED}" COMMAND_ERROR_IS_FATAL ANY)
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${MIRTAR_CONFIG}")
idf_component_register(SRCS "main.c" "ui.c" "state.c" "ble_transport.c" "../assets/mirtar_font_16.c"
    INCLUDE_DIRS "." "${CMAKE_CURRENT_BINARY_DIR}"
    REQUIRES bsp bt esp_wifi esp_netif esp_event nvs_flash esp_websocket_client json mbedtls esp_timer)
