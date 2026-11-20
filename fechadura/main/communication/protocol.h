#ifndef SMART_ENTRY_PROTOCOL_H
#define SMART_ENTRY_PROTOCOL_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Zigbee Profile, Endpoint and Cluster definitions */
#define SMART_ENTRY_PROFILE_ID 0x0104 /* Home Automation */
#define SMART_ENTRY_ENDPOINT_ID 1
#define SMART_ENTRY_CLUSTER_ID 0xFC00      /* Private cluster SmartEntry */
#define SMART_ENTRY_TIME_CLUSTER_ID 0x000A /* Standard ZCL Time cluster */

/* ZCL Command IDs for Cluster 0xFC00 */
#define SMART_ENTRY_CMD_REQUEST 0x00  /* Pi -> ESP */
#define SMART_ENTRY_CMD_RESPONSE 0x01 /* ESP -> Pi */
#define SMART_ENTRY_CMD_EVENT 0x02    /* ESP -> Pi */

/* Envelope constants */
#define SMART_ENTRY_PROTOCOL_VERSION 1
#define SMART_ENTRY_KIND_REQUEST 0
#define SMART_ENTRY_KIND_RESPONSE 1
#define SMART_ENTRY_KIND_EVENT 2

#define SMART_ENTRY_HMAC_PREFIX "SmartEntry/v1"
#define SMART_ENTRY_HMAC_PREFIX_LEN 13 /* ASCII("SmartEntry/v1") */
#define SMART_ENTRY_APP_KEY_LEN 32
#define SMART_ENTRY_IEEE_LEN 8
#define SMART_ENTRY_SESSION_CHALLENGE_LEN 8

#define SMART_ENTRY_HEADER_LEN 21 /* Offset 0..20 (before data) */
#define SMART_ENTRY_TAG_LEN 16    /* HMAC tag length */
#define SMART_ENTRY_MIN_ENVELOPE_LEN                                           \
    (SMART_ENTRY_HEADER_LEN + SMART_ENTRY_TAG_LEN) /* 37 */
#define SMART_ENTRY_MAX_NAME_LEN 20
#define SMART_ENTRY_MAX_DATA_LEN                                               \
    (SMART_ENTRY_APP_KEY_LEN + 1 + SMART_ENTRY_MAX_NAME_LEN) /* 53 */
#define SMART_ENTRY_MAX_ENVELOPE_LEN                                           \
    (SMART_ENTRY_MIN_ENVELOPE_LEN + SMART_ENTRY_MAX_DATA_LEN) /* 90 */

/* Slot definitions */
#define SMART_ENTRY_MAX_SLOTS 10 /* Slots 0..9 */
#define SMART_ENTRY_SLOT_UNASSIGNED 0xFF

/* Slot bitmap flags */
#define SMART_ENTRY_SLOT_FLAG_OCCUPIED (1U << 0)
#define SMART_ENTRY_SLOT_FLAG_TOTP (1U << 1)
#define SMART_ENTRY_SLOT_FLAG_RFID (1U << 2)

/* Request / Response Opcodes */
#define SMART_ENTRY_OPCODE_LIST_SLOTS 1
#define SMART_ENTRY_OPCODE_SET_USER 2
#define SMART_ENTRY_OPCODE_CLEAR_USER 3
#define SMART_ENTRY_OPCODE_UNLOCK 4
#define SMART_ENTRY_OPCODE_GET_USER 5

/* Event Types */
#define SMART_ENTRY_EVENT_STATUS 1
#define SMART_ENTRY_EVENT_ACCESS 2

/* Result codes returned in response data[0] */
#define SMART_ENTRY_RESULT_SUCCESS 0
#define SMART_ENTRY_RESULT_SLOT_OCCUPIED 1
#define SMART_ENTRY_RESULT_SLOT_EMPTY 2
#define SMART_ENTRY_RESULT_CLOCK_UNRELIABLE 3
#define SMART_ENTRY_RESULT_EXPIRED 4 /* Pi numbering; deadline not enforced */
#define SMART_ENTRY_RESULT_REPLAY_COUNTER 5
#define SMART_ENTRY_RESULT_BAD_PAYLOAD 6
#define SMART_ENTRY_RESULT_PERSIST_OR_MECH_FAIL 7

/* Event Access Methods and Results */
#define SMART_ENTRY_ACCESS_METHOD_TOTP 0
#define SMART_ENTRY_ACCESS_METHOD_RFID 1
#define SMART_ENTRY_ACCESS_RESULT_SUCCESS 0
#define SMART_ENTRY_ACCESS_RESULT_FAILURE 1

/* Door physical lock status */
#define SMART_ENTRY_DOOR_UNLOCKED 0
#define SMART_ENTRY_DOOR_LOCKED 1

/* Parsed envelope representation */
typedef struct {
    uint8_t version;
    uint8_t kind;
    uint8_t opcode;
    uint8_t slot;
    uint32_t counter;
    uint8_t session[SMART_ENTRY_SESSION_CHALLENGE_LEN];
    uint32_t deadline; /* Unix UTC seconds; only echoed back to the Pi */
    uint8_t data_len;
    uint8_t data[SMART_ENTRY_MAX_DATA_LEN];
    uint8_t tag[SMART_ENTRY_TAG_LEN];
} smart_entry_envelope_t;

/**
 * @brief Parse a raw envelope buffer (without ZCL length prefix).
 *
 * @param buf Pointer to raw bytes.
 * @param buf_len Total length of buffer.
 * @param out_env Pointer to envelope structure to populate.
 * @return true if successfully parsed and bounds check passed, false otherwise.
 */
bool smart_entry_parse_envelope(const uint8_t *buf, size_t buf_len,
                                smart_entry_envelope_t *out_env);

/**
 * @brief Serialize an envelope structure into a raw buffer (without ZCL length
 * prefix).
 *
 * @param env Pointer to envelope structure.
 * @param out_buf Output buffer (must have at least SMART_ENTRY_MAX_ENVELOPE_LEN
 * bytes).
 * @param out_len Output actual length written (37 + data_len).
 * @return true if serialized, false on invalid parameters.
 */
bool smart_entry_serialize_envelope_no_tag(const smart_entry_envelope_t *env,
                                           uint8_t *out_buf, size_t *out_len);

#ifdef __cplusplus
}
#endif

#endif /* SMART_ENTRY_PROTOCOL_H */
