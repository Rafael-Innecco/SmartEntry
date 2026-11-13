#include "protocol.h"
#include <string.h>

bool smart_entry_parse_envelope(const uint8_t *buf, size_t buf_len,
                                smart_entry_envelope_t *out_env) {
    if (!buf || !out_env) {
        return false;
    }

    if (buf_len < SMART_ENTRY_MIN_ENVELOPE_LEN) {
        return false;
    }

    uint8_t data_len = buf[20];
    if (data_len > SMART_ENTRY_MAX_DATA_LEN) {
        return false;
    }

    if (buf_len != (size_t)(SMART_ENTRY_MIN_ENVELOPE_LEN + data_len)) {
        return false;
    }

    out_env->version = buf[0];
    if (out_env->version != SMART_ENTRY_PROTOCOL_VERSION) {
        return false;
    }

    out_env->kind = buf[1];
    out_env->opcode = buf[2];
    out_env->slot = buf[3];

    /* Little-endian 32-bit counter */
    out_env->counter = (uint32_t)buf[4] | ((uint32_t)buf[5] << 8) |
                       ((uint32_t)buf[6] << 16) | ((uint32_t)buf[7] << 24);

    /* Session challenge (8 bytes) */
    memcpy(out_env->session, &buf[8], SMART_ENTRY_SESSION_CHALLENGE_LEN);

    /* Little-endian 32-bit deadline */
    out_env->deadline = (uint32_t)buf[16] | ((uint32_t)buf[17] << 8) |
                        ((uint32_t)buf[18] << 16) | ((uint32_t)buf[19] << 24);

    out_env->data_len = data_len;
    if (data_len > 0) {
        memcpy(out_env->data, &buf[21], data_len);
    }

    /* Tag is at offset 21 + data_len */
    memcpy(out_env->tag, &buf[21 + data_len], SMART_ENTRY_TAG_LEN);

    return true;
}

bool smart_entry_serialize_envelope_no_tag(const smart_entry_envelope_t *env,
                                           uint8_t *out_buf, size_t *out_len) {
    if (!env || !out_buf || !out_len) {
        return false;
    }

    if (env->data_len > SMART_ENTRY_MAX_DATA_LEN) {
        return false;
    }

    out_buf[0] = env->version;
    out_buf[1] = env->kind;
    out_buf[2] = env->opcode;
    out_buf[3] = env->slot;

    /* Little-endian counter */
    out_buf[4] = (uint8_t)(env->counter & 0xFF);
    out_buf[5] = (uint8_t)((env->counter >> 8) & 0xFF);
    out_buf[6] = (uint8_t)((env->counter >> 16) & 0xFF);
    out_buf[7] = (uint8_t)((env->counter >> 24) & 0xFF);

    /* Session challenge */
    memcpy(&out_buf[8], env->session, SMART_ENTRY_SESSION_CHALLENGE_LEN);

    /* Little-endian deadline */
    out_buf[16] = (uint8_t)(env->deadline & 0xFF);
    out_buf[17] = (uint8_t)((env->deadline >> 8) & 0xFF);
    out_buf[18] = (uint8_t)((env->deadline >> 16) & 0xFF);
    out_buf[19] = (uint8_t)((env->deadline >> 24) & 0xFF);

    out_buf[20] = env->data_len;
    if (env->data_len > 0) {
        memcpy(&out_buf[21], env->data, env->data_len);
    }

    *out_len = SMART_ENTRY_HEADER_LEN + env->data_len;
    return true;
}
