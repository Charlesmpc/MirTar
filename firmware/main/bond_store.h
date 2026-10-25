#pragma once
#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"

// A stable server ID owns an opaque NimBLE store and a private static identity.
// NULL selects a fresh enrollment staging profile, never an existing server.
esp_err_t mt_bond_prepare(const char *server_id, uint8_t address[6]);
esp_err_t mt_bond_promote(const char *server_id);
esp_err_t mt_bond_reset(const char *server_id);
bool mt_bond_matches(const char *server_id);
bool mt_bond_namespace(const char *server_id, char output[16]);
