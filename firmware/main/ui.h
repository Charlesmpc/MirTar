#pragma once
#include <stdbool.h>
#include "state.h"
void mt_ui_init(bool reading_skin);
void mt_ui_render(const mt_state_t *state, const char *status, const char *body, int battery);
void mt_ui_recording(unsigned seconds, unsigned level);
void mt_ui_scroll(int direction);
