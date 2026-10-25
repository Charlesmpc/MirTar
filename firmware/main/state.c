#include "state.h"
bool mt_can_record(const mt_state_t *s) {
    return s && s->page == MT_READING && s->connected && s->bound && !s->recording &&
        !s->submitting && s->selected >= 0 && s->selected < s->session_count;
}
bool mt_can_switch(const mt_state_t *s) { return s && !s->recording; }
void mt_disconnect(mt_state_t *s) {
    if (!s) return;
    s->connected = s->bound = s->recording = false;
    /* An accepted/uncertain submission must not be automatically replayed. */
    s->page = MT_MACHINES;
}
