#include "data_stream_server.h"
#include "crypto.h"
#include "esp_log.h"
#include "event_manager.h"
#include "lock_controller.h"
#include "protocol.h"
#include "storage.h"
#include "time_sync.h"
#include <string.h>

static const char *TAG = "SE_SERVER";

#define CMD_HDR_TO_RSP(header)                                                 \
    {                                                                          \
        .dst_addr = header->src_addr,                                          \
        .dst_ep = header->src_ep,                                              \
        .src_ep = header->dst_ep,                                              \
        .cluster_id = header->cluster_id,                                      \
        .manuf_code = header->manuf_code,                                      \
        .fc = {.manuf_specific = false,                                        \
               .direction = EZB_ZCL_CMD_DIRECTION_TO_CLI,                      \
               .dis_default_rsp = true},                                       \
    }

static ezb_err_t
send_zcl_response(const ezb_zcl_cmd_hdr_t *header,
                  const smart_entry_envelope_t *rsp_env,
                  const uint8_t key[SMART_ENTRY_APP_KEY_LEN],
                  const uint8_t ieee_be[SMART_ENTRY_IEEE_LEN]) {
    uint8_t env_buf[SMART_ENTRY_MAX_ENVELOPE_LEN];
    size_t env_no_tag_len = 0;

    if (!smart_entry_serialize_envelope_no_tag(rsp_env, env_buf,
                                               &env_no_tag_len)) {
        ESP_LOGE(TAG, "Failed to serialize response envelope");
        return EZB_ERR_FAIL;
    }

    uint8_t tag[SMART_ENTRY_TAG_LEN];
    if (!smart_entry_compute_hmac(key, ieee_be, env_buf, env_no_tag_len, tag)) {
        ESP_LOGE(TAG, "Failed to compute response HMAC");
        return EZB_ERR_FAIL;
    }
    memcpy(&env_buf[env_no_tag_len], tag, SMART_ENTRY_TAG_LEN);
    size_t total_env_len = env_no_tag_len + SMART_ENTRY_TAG_LEN;

    /* Build ZCL OCTET_STR: 1 length byte followed by envelope bytes */
    uint8_t zcl_payload[SMART_ENTRY_MAX_ENVELOPE_LEN + 1];
    zcl_payload[0] = (uint8_t)total_env_len;
    memcpy(&zcl_payload[1], env_buf, total_env_len);

    /* Cache response for replay protection */
    smart_entry_storage_cache_response(rsp_env->counter, zcl_payload,
                                       total_env_len + 1);

    ezb_zcl_custom_cluster_cmd_t cmd_req = {
        .cmd_ctrl = CMD_HDR_TO_RSP(header),
        .cmd_id = SMART_ENTRY_CMD_RESPONSE,
        .data_length = total_env_len + 1,
        .data = zcl_payload,
    };

    return ezb_zcl_custom_cluster_cmd_req(&cmd_req);
}

static ezb_zcl_status_t
handle_smart_entry_request(const ezb_zcl_cmd_hdr_t *header,
                           const uint8_t *payload, uint16_t payload_length) {
    /* Payload must be OCTET_STR: at least 1-byte length prefix + 37-byte
     * envelope */
    if (!payload || payload_length < (1 + SMART_ENTRY_MIN_ENVELOPE_LEN)) {
        ESP_LOGW(TAG, "Malformed ZCL request payload length: %u",
                 payload_length);
        return EZB_ZCL_STATUS_INVALID_FIELD;
    }

    uint8_t octet_len = payload[0];
    if (octet_len + 1 != payload_length ||
        octet_len < SMART_ENTRY_MIN_ENVELOPE_LEN ||
        octet_len > SMART_ENTRY_MAX_ENVELOPE_LEN) {
        ESP_LOGW(TAG, "Mismatched OCTET_STR length: %u vs total %u", octet_len,
                 payload_length);
        return EZB_ZCL_STATUS_INVALID_FIELD;
    }

    const uint8_t *raw_env = &payload[1];
    smart_entry_envelope_t req_env;
    if (!smart_entry_parse_envelope(raw_env, octet_len, &req_env)) {
        ESP_LOGW(TAG, "Failed to parse envelope format");
        return EZB_ZCL_STATUS_INVALID_FIELD;
    }

    if (req_env.kind != SMART_ENTRY_KIND_REQUEST) {
        ESP_LOGW(TAG, "Invalid kind in request: %u", req_env.kind);
        return EZB_ZCL_STATUS_INVALID_FIELD;
    }

    /* Verify HMAC */
    uint8_t app_key[SMART_ENTRY_APP_KEY_LEN];
    if (!smart_entry_storage_get_app_key(app_key)) {
        ESP_LOGE(TAG, "Application key not found in storage");
        return EZB_ZCL_STATUS_FAIL;
    }

    ezb_extaddr_t ext_addr;
    ezb_nwk_get_extended_address(&ext_addr);
    uint8_t ieee_be[SMART_ENTRY_IEEE_LEN];
    smart_entry_ieee_to_big_endian(ext_addr.u64, ieee_be);

    size_t env_no_tag_len = SMART_ENTRY_HEADER_LEN + req_env.data_len;
    if (!smart_entry_verify_hmac(app_key, ieee_be, raw_env, env_no_tag_len,
                                 req_env.tag)) {
        /* Protocol requirement: DO NOT respond to invalid HMAC */
        ESP_LOGW(TAG, "Invalid HMAC tag: silently dropping request");
        return EZB_ZCL_STATUS_SUCCESS;
    }

    /* Counter check and replay protection */
    uint32_t last_counter = smart_entry_storage_get_counter();

    /* Prepare base response envelope repeating opcode, slot, counter, session */
    smart_entry_envelope_t rsp_env = {
        .version = SMART_ENTRY_PROTOCOL_VERSION,
        .kind = SMART_ENTRY_KIND_RESPONSE,
        .opcode = req_env.opcode,
        .slot = req_env.slot,
        .counter = req_env.counter,
        .data_len = 1,
    };
    memcpy(rsp_env.session, req_env.session, SMART_ENTRY_SESSION_CHALLENGE_LEN);

    if (req_env.counter <= last_counter) {
        /* Check for exact duplicate in cache */
        uint8_t cached_buf[SMART_ENTRY_MAX_ENVELOPE_LEN + 1];
        size_t cached_len = 0;
        if (smart_entry_storage_get_cached_response(req_env.counter, cached_buf,
                                                    &cached_len)) {
            ESP_LOGI(TAG, "Replaying cached response for counter %lu",
                     (unsigned long)req_env.counter);
            ezb_zcl_custom_cluster_cmd_t cmd_req = {
                .cmd_ctrl = CMD_HDR_TO_RSP(header),
                .cmd_id = SMART_ENTRY_CMD_RESPONSE,
                .data_length = cached_len,
                .data = cached_buf,
            };
            ezb_zcl_custom_cluster_cmd_req(&cmd_req);
            return EZB_ZCL_STATUS_SUCCESS;
        }

        /* Without cache or for stale counter, reply with REPLAY error */
        ESP_LOGW(TAG, "Stale/replayed counter %lu <= last %lu",
                 (unsigned long)req_env.counter, (unsigned long)last_counter);
        rsp_env.data[0] = SMART_ENTRY_RESULT_REPLAY_COUNTER;
        send_zcl_response(header, &rsp_env, app_key, ieee_be);
        return EZB_ZCL_STATUS_SUCCESS;
    }

    /* Persist the new counter BEFORE any effect or success response */
    if (!smart_entry_storage_persist_counter(req_env.counter)) {
        ESP_LOGE(TAG, "Failed to persist new counter to NVS");
        rsp_env.data[0] = SMART_ENTRY_RESULT_PERSIST_OR_MECH_FAIL;
        send_zcl_response(header, &rsp_env, app_key, ieee_be);
        return EZB_ZCL_STATUS_SUCCESS;
    }

    /* Dispatch Opcodes */
    switch (req_env.opcode) {
    case SMART_ENTRY_OPCODE_LIST_SLOTS: {
        ESP_LOGI(TAG, "Received LIST_SLOTS OPCODE");
        /* Opcode 1 listSlots: slot FF,  no data */
        if (req_env.slot != SMART_ENTRY_SLOT_UNASSIGNED ||
            req_env.data_len != 0) {
            rsp_env.data[0] = SMART_ENTRY_RESULT_BAD_PAYLOAD;
            break;
        }

        /* Adopt session challenge for subsequent events and reset sequence */
        smart_entry_event_adopt_session(req_env.session);

        /* Success response: result 0x00 + 1 byte locked + 10 bytes slot bitmap
         */
        rsp_env.data[0] = SMART_ENTRY_RESULT_SUCCESS;
        rsp_env.data[1] = smart_entry_get_lock_state();
        smart_entry_storage_get_slots_bitmap(&rsp_env.data[2]);
        rsp_env.data_len = 1 + 1 + SMART_ENTRY_MAX_SLOTS; /* 12 bytes */
        break;
    }

    case SMART_ENTRY_OPCODE_SET_USER: {
        ESP_LOGI(TAG, "Received SET_USER OPCODE");
        /* Opcode 2 setUser: slot 0..9, 32 bytes TOTP secret */
        if (req_env.slot >= SMART_ENTRY_MAX_SLOTS ||
            req_env.data_len != SMART_ENTRY_APP_KEY_LEN) {
            rsp_env.data[0] = SMART_ENTRY_RESULT_BAD_PAYLOAD;
            break;
        }

        smart_entry_slot_t existing_slot;
        if (smart_entry_storage_get_slot(req_env.slot, &existing_slot) &&
            (existing_slot.flags & SMART_ENTRY_SLOT_FLAG_OCCUPIED)) {
            /* Slot already occupied */
            rsp_env.data[0] = SMART_ENTRY_RESULT_SLOT_OCCUPIED;
            break;
        }

        if (!smart_entry_storage_set_slot(req_env.slot, req_env.data)) {
            rsp_env.data[0] = SMART_ENTRY_RESULT_PERSIST_OR_MECH_FAIL;
            break;
        }

        rsp_env.data[0] = SMART_ENTRY_RESULT_SUCCESS;
        rsp_env.data_len = 1;
        break;
    }

    case SMART_ENTRY_OPCODE_CLEAR_USER: {
        ESP_LOGI(TAG, "Received CLEAR_USER OPCODE");
        /* Opcode 3 clearUser: slot 0..9, no data */
        if (req_env.slot >= SMART_ENTRY_MAX_SLOTS || req_env.data_len != 0) {
            rsp_env.data[0] = SMART_ENTRY_RESULT_BAD_PAYLOAD;
            break;
        }

        smart_entry_slot_t existing_slot;
        if (!smart_entry_storage_get_slot(req_env.slot, &existing_slot) ||
            !(existing_slot.flags & SMART_ENTRY_SLOT_FLAG_OCCUPIED)) {
            /* Slot already empty */
            rsp_env.data[0] = SMART_ENTRY_RESULT_SLOT_EMPTY;
            break;
        }

        if (!smart_entry_storage_clear_slot(req_env.slot)) {
            rsp_env.data[0] = SMART_ENTRY_RESULT_PERSIST_OR_MECH_FAIL;
            break;
        }

        rsp_env.data[0] = SMART_ENTRY_RESULT_SUCCESS;
        rsp_env.data_len = 1;
        break;
    }

    case SMART_ENTRY_OPCODE_UNLOCK: {
        ESP_LOGI(TAG, "Received UNLOCK OPCODE");
        /* Opcode 4 unlock: slot FF, no data */
        if (req_env.slot != SMART_ENTRY_SLOT_UNASSIGNED ||
            req_env.data_len != 0) {
            rsp_env.data[0] = SMART_ENTRY_RESULT_BAD_PAYLOAD;
            break;
        }

        if (!smart_entry_perform_unlock()) {
            rsp_env.data[0] = SMART_ENTRY_RESULT_PERSIST_OR_MECH_FAIL;
            break;
        }

        rsp_env.data[0] = SMART_ENTRY_RESULT_SUCCESS;
        rsp_env.data[1] = SMART_ENTRY_DOOR_UNLOCKED;
        rsp_env.data_len = 2;
        break;
    }

    default:
        ESP_LOGE(TAG, "Received UNKNOWN OPCODE");
        rsp_env.data[0] = SMART_ENTRY_RESULT_BAD_PAYLOAD;
        break;
    }

    send_zcl_response(header, &rsp_env, app_key, ieee_be);
    return EZB_ZCL_STATUS_SUCCESS;
}

static ezb_zcl_status_t
smart_entry_server_cmd_handler(const ezb_zcl_cmd_hdr_t *header,
                               const uint8_t *payload,
                               uint16_t payload_length) {
    if (!header)
        return EZB_ZCL_STATUS_FAIL;

    if (header->cluster_id != SMART_ENTRY_CLUSTER_ID) {
        return EZB_ZCL_STATUS_UNSUPPORTED_CLUSTER;
    }

    if (EZB_ZCL_CMD_FC_IS_TO_CLI_DIRECTION(header->fc)) {
        return EZB_ZCL_STATUS_INVALID_FIELD;
    }

    if (header->cmd_id == SMART_ENTRY_CMD_REQUEST) {
        return handle_smart_entry_request(header, payload, payload_length);
    }

    return EZB_ZCL_STATUS_UNSUP_CMD;
}

static uint8_t smart_entry_server_disc_cmd_handler(bool is_recv,
                                                   uint8_t **list) {
    static uint8_t recv_cmd_list[] = {SMART_ENTRY_CMD_REQUEST};
    static uint8_t send_cmd_list[] = {SMART_ENTRY_CMD_RESPONSE,
                                      SMART_ENTRY_CMD_EVENT};

    *list = is_recv ? recv_cmd_list : send_cmd_list;
    return is_recv ? sizeof(recv_cmd_list) : sizeof(send_cmd_list);
}

void esp_zigbee_zcl_smart_entry_server_init(uint8_t ep_id) {
    ezb_zcl_custom_cluster_handlers_t handlers = {
        .cluster_id = SMART_ENTRY_CLUSTER_ID,
        .cluster_role = EZB_ZCL_CLUSTER_SERVER,
        .process_cmd_cb = smart_entry_server_cmd_handler,
        .check_value_cb = NULL,
        .write_attr_cb = NULL,
        .cmd_disc_cb = smart_entry_server_disc_cmd_handler,
    };
    ezb_zcl_custom_cluster_handlers_register(&handlers);
    ESP_LOGI(
        TAG,
        "SmartEntry private cluster 0x%04X server initialized on endpoint %d",
        SMART_ENTRY_CLUSTER_ID, ep_id);
}

void esp_zigbee_zcl_smart_entry_server_deinit(uint8_t ep_id) {
    ESP_LOGI(TAG, "SmartEntry server deinitialized on endpoint %d", ep_id);
}
