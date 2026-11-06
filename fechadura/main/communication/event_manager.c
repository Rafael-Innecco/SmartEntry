#include "event_manager.h"
#include <string.h>
#include "esp_log.h"
#include "esp_zigbee.h"
#include "crypto.h"
#include "storage.h"

static const char *TAG = "SE_EVENT";

static bool s_session_active = false;
static uint8_t s_session_challenge[SMART_ENTRY_SESSION_CHALLENGE_LEN];
static uint32_t s_event_seq = 1;

void smart_entry_event_init(void) {
    s_session_active = false;
    memset(s_session_challenge, 0, sizeof(s_session_challenge));
    s_event_seq = 1;
    ESP_LOGI(TAG, "Event manager initialized (no active session)");
}

void smart_entry_event_adopt_session(const uint8_t session_8B[SMART_ENTRY_SESSION_CHALLENGE_LEN]) {
    if (!session_8B) return;
    memcpy(s_session_challenge, session_8B, SMART_ENTRY_SESSION_CHALLENGE_LEN);
    s_event_seq = 1;
    s_session_active = true;
    ESP_LOGI(TAG, "Adopted new event session from listSlots; sequence reset to 1");
}

bool smart_entry_event_is_session_active(void) {
    return s_session_active;
}

static bool send_envelope_event(const smart_entry_envelope_t *env) {
    if (!s_session_active) {
        ESP_LOGW(TAG, "Cannot send event: no active session from coordinator");
        return false;
    }

    uint8_t key[SMART_ENTRY_APP_KEY_LEN];
    if (!smart_entry_storage_get_app_key(key)) {
        ESP_LOGE(TAG, "Cannot send event: missing app key");
        return false;
    }

    ezb_extaddr_t ext_addr;
    ezb_nwk_get_extended_address(&ext_addr);
    uint8_t ieee_be[SMART_ENTRY_IEEE_LEN];
    smart_entry_ieee_to_big_endian(ext_addr.u64, ieee_be);

    /* Serialize envelope without tag */
    uint8_t env_buf[SMART_ENTRY_MAX_ENVELOPE_LEN];
    size_t env_no_tag_len = 0;
    if (!smart_entry_serialize_envelope_no_tag(env, env_buf, &env_no_tag_len)) {
        ESP_LOGE(TAG, "Failed to serialize event envelope");
        return false;
    }

    /* Compute HMAC */
    uint8_t tag[SMART_ENTRY_TAG_LEN];
    if (!smart_entry_compute_hmac(key, ieee_be, env_buf, env_no_tag_len, tag)) {
        ESP_LOGE(TAG, "Failed to compute HMAC for event");
        return false;
    }
    memcpy(&env_buf[env_no_tag_len], tag, SMART_ENTRY_TAG_LEN);
    size_t full_env_len = env_no_tag_len + SMART_ENTRY_TAG_LEN;

    /* Build ZCL OCTET_STR payload: 1 byte length prefix + envelope bytes */
    uint8_t zcl_payload[SMART_ENTRY_MAX_ENVELOPE_LEN + 1];
    zcl_payload[0] = (uint8_t)full_env_len;
    memcpy(&zcl_payload[1], env_buf, full_env_len);

    ezb_zcl_custom_cluster_cmd_t cmd_req = {
        .cmd_ctrl = {
            .dst_addr = {
                .addr_mode = EZB_ADDR_MODE_SHORT,
                .u = {
                    .short_addr = 0x0000, /* Coordinator short address */
                },
            },
            .dst_ep = SMART_ENTRY_ENDPOINT_ID,
            .src_ep = SMART_ENTRY_ENDPOINT_ID,
            .cluster_id = SMART_ENTRY_CLUSTER_ID,
            .manuf_code = EZB_ZCL_STD_MANUF_CODE,
            .fc = {
                .manuf_specific = false,
                .direction = EZB_ZCL_CMD_DIRECTION_TO_CLI,
                .dis_default_rsp = true,
            },
        },
        .cmd_id = SMART_ENTRY_CMD_EVENT,
        .data_length = full_env_len + 1,
        .data = zcl_payload,
    };

    ezb_err_t err = ezb_zcl_custom_cluster_cmd_req(&cmd_req);
    if (err != EZB_ERR_NONE) {
        ESP_LOGE(TAG, "Failed to transmit event frame: 0x%02x", err);
        return false;
    }

    ESP_LOGI(TAG, "Dispatched event type %d, seq %lu", env->opcode, (unsigned long)env->counter);
    s_event_seq++;
    return true;
}

bool smart_entry_send_status_event(uint8_t locked) {
    if (!s_session_active) return false;

    smart_entry_envelope_t env = {
        .version = SMART_ENTRY_PROTOCOL_VERSION,
        .kind = SMART_ENTRY_KIND_EVENT,
        .opcode = SMART_ENTRY_EVENT_STATUS,
        .slot = SMART_ENTRY_SLOT_UNASSIGNED,
        .counter = s_event_seq,
        .data_len = 1,
    };
    memcpy(env.session, s_session_challenge, SMART_ENTRY_SESSION_CHALLENGE_LEN);
    env.data[0] = (locked != 0) ? SMART_ENTRY_DOOR_LOCKED : SMART_ENTRY_DOOR_UNLOCKED;

    return send_envelope_event(&env);
}

bool smart_entry_send_access_event(uint8_t slot, uint8_t method, uint8_t result) {
    if (!s_session_active) return false;

    smart_entry_envelope_t env = {
        .version = SMART_ENTRY_PROTOCOL_VERSION,
        .kind = SMART_ENTRY_KIND_EVENT,
        .opcode = SMART_ENTRY_EVENT_ACCESS,
        .slot = slot,
        .counter = s_event_seq,
        .data_len = 2,
    };
    memcpy(env.session, s_session_challenge, SMART_ENTRY_SESSION_CHALLENGE_LEN);
    env.data[0] = method;
    env.data[1] = result;

    return send_envelope_event(&env);
}
