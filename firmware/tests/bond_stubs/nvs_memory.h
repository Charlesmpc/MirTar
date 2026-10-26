#pragma once
#include "nvs.h"
extern const char *fail_set_key,*fail_commit_space;
extern unsigned fail_commit_skip;
const char *test_nvs_namespace(nvs_handle_t);
esp_err_t __wrap_nvs_open(const char *,nvs_open_mode_t,nvs_handle_t *);
