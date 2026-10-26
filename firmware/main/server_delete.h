#pragma once
#include "esp_err.h"

/* Only call with all transports stopped. Persist intent BEFORE erasing anything.
 * On failure, block reconnect/config import and retry recover (also on boot).
 * Windows' own pairing records and the source config-file are outside the card. */
esp_err_t mt_server_delete(const char *server_id);
esp_err_t mt_server_delete_recover(void);
