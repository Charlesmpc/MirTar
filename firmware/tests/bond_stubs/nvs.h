#pragma once
#include <stddef.h>
#include "esp_err.h"
typedef unsigned nvs_handle_t;
typedef enum {NVS_READONLY,NVS_READWRITE} nvs_open_mode_t;
typedef enum {NVS_TYPE_BLOB=0x42,NVS_TYPE_ANY=0xff} nvs_type_t;
typedef struct test_iterator *nvs_iterator_t;
typedef struct {char namespace_name[16],key[16];nvs_type_t type;} nvs_entry_info_t;
esp_err_t nvs_open(const char *,nvs_open_mode_t,nvs_handle_t *);
esp_err_t nvs_get_blob(nvs_handle_t,const char *,void *,size_t *);
esp_err_t nvs_set_blob(nvs_handle_t,const char *,const void *,size_t);
esp_err_t nvs_erase_all(nvs_handle_t);
esp_err_t nvs_commit(nvs_handle_t);
void nvs_close(nvs_handle_t);
esp_err_t nvs_entry_find(const char *,const char *,nvs_type_t,nvs_iterator_t *);
esp_err_t nvs_entry_next(nvs_iterator_t *);
void nvs_entry_info(nvs_iterator_t,nvs_entry_info_t *);
void nvs_release_iterator(nvs_iterator_t);
