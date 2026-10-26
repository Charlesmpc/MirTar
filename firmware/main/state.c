#include "state.h"
bool mt_can_record(const mt_state_t *s) {
    return s && s->page == MT_READING && s->connected && s->bound && !s->recording &&
        !s->submitting && !s->question_pending && s->selected >= 0 && s->selected < s->session_count;
}
bool mt_can_answer(const mt_state_t *s){return s&&(s->page==MT_QUESTION||s->page==MT_ANSWER_MENU)&&s->connected&&s->bound&&
    s->question_pending&&!s->recording&&!s->answer_submitting&&s->selected>=0&&s->selected<s->session_count;}
bool mt_can_switch(const mt_state_t *s) { return s && !s->recording; }
void mt_disconnect(mt_state_t *s) {
    if (!s) return;
    s->connected = s->bound = s->recording = false;
    s->question_pending = s->answer_submitting = false;
    /* An accepted/uncertain submission must not be automatically replayed. */
    s->page = MT_MACHINES;
}
void mt_ble_wait_start(mt_state_t *s, int64_t now) {
    if (!s || s->transport != MT_BLUETOOTH || s->page != MT_CONNECTING || s->ble_waiting) return;
    s->ble_waiting = true; s->ble_wait_since = now; s->ble_reset_offered = false;
}
void mt_ble_wait_clear(mt_state_t *s) {
    if (!s) return;
    s->ble_waiting = s->ble_reset_offered = false; s->ble_wait_since = 0;
}
bool mt_ble_can_offer_reset(const mt_state_t *s) {
    return s && s->transport == MT_BLUETOOTH && s->page == MT_CONNECTING &&
        s->ble_waiting && s->ble_reset_offered && !s->bound && !s->recording;
}
bool mt_ble_wait_update(mt_state_t *s, int64_t now) {
    if (!s || s->transport != MT_BLUETOOTH || s->page != MT_CONNECTING || !s->ble_waiting ||
        s->ble_reset_offered || s->bound || s->recording || now < s->ble_wait_since ||
        now - s->ble_wait_since < 60000000) return false;
    s->ble_reset_offered = true; return true;
}
