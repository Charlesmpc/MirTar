#pragma once
#include <stdbool.h>
#include <stdint.h>
#define MT_REPLY_MAX 6144
#define MT_SESSION_MAX 8
typedef enum { MT_HOME, MT_MACHINES, MT_PAIRING, MT_PAIR_CONFIRM, MT_SETUP, MT_TRANSPORT, MT_CONNECTING, MT_SESSIONS, MT_READING } mt_page_t;
typedef enum { MT_BLUETOOTH, MT_WIFI } mt_transport_t;
typedef struct {
    char id[64];
    char name[64];
} mt_session_t;
typedef struct {
    mt_page_t page;
    mt_transport_t transport;
    bool wifi, connected, bound, recording, submitting;
    int session_count, selected;
    uint32_t input_id;
    char target_name[48];
    mt_session_t sessions[MT_SESSION_MAX];
} mt_state_t;
bool mt_can_record(const mt_state_t *state);
bool mt_can_switch(const mt_state_t *state);
void mt_disconnect(mt_state_t *state);
