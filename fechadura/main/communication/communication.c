#include "communication.h"
#include "alarm_timer.h"
#include "crypto.h"
#include "data_stream_server.h"
#include "esp_err.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_zigbee.h"
#include "event_manager.h"
#include "lock_controller.h"
#include "nvs_flash.h"
#include "protocol.h"
#include "storage.h"
#include "time_sync.h"
#include <inttypes.h>
#include <stdio.h>
#include <string.h>

static const char *TAG = "SE_COMM";

#define TIME_SYNC_INTERVAL_US (300ULL * 1000 * 1000) /* 5 minutes */

static esp_timer_handle_t s_time_sync_timer = NULL;

static void time_sync_timer_cb(void *arg) {
    ESP_LOGI(TAG, "Periodic time synchronization triggered");
    smart_entry_request_time_sync();
}

static void esp_zigbee_alarm_bdb_commissioning(alarm_timer_arg_t arg) {
    esp_zigbee_lock_acquire(portMAX_DELAY);
    (void)ezb_bdb_start_top_level_commissioning(arg);
    esp_zigbee_lock_release();
}

static bool esp_zigbee_app_signal_handler(const ezb_app_signal_t *app_signal) {
    ezb_app_signal_type_t signal_type = ezb_app_signal_get_type(app_signal);

    switch (signal_type) {
    case EZB_ZDO_SIGNAL_SKIP_STARTUP:
        ESP_LOGI(TAG, "Initialize Zigbee stack");
        ezb_bdb_start_top_level_commissioning(EZB_BDB_MODE_INITIALIZATION);
        break;

    case EZB_BDB_SIGNAL_DEVICE_FIRST_START:
    case EZB_BDB_SIGNAL_DEVICE_REBOOT: {
        ezb_bdb_comm_status_t status =
            *((ezb_bdb_comm_status_t *)ezb_app_signal_get_params(app_signal));
        if (status == EZB_BDB_STATUS_SUCCESS) {
            ESP_LOGI(TAG, "Device started up in %s factory-reset mode",
                     ezb_bdb_is_factory_new() ? "" : "non");
            /* Logged before joining: the Pi needs this value (SMART_ENTRY_LOCK_IEEE) to pair. */
            ezb_extaddr_t ext_addr;
            ezb_nwk_get_extended_address(&ext_addr);
            ESP_LOGI(TAG, "Lock IEEE: 0x%016" PRIx64, ext_addr.u64);
            if (ezb_bdb_is_factory_new()) {
                ezb_bdb_start_top_level_commissioning(
                    EZB_BDB_MODE_NETWORK_STEERING);
            } else {
                ESP_LOGI(TAG, "Device rebooted, joined network");
                smart_entry_request_time_sync();
            }
        } else {
            ESP_LOGW(TAG, "%s failed with status(0x%02x), retry again",
                     ezb_app_signal_to_string(signal_type), status);
            alarm_timer_schedule(esp_zigbee_alarm_bdb_commissioning,
                                 EZB_BDB_MODE_INITIALIZATION, 1000);
        }
    } break;

    case EZB_BDB_SIGNAL_STEERING: {
        ezb_bdb_comm_status_t status =
            *((ezb_bdb_comm_status_t *)ezb_app_signal_get_params(app_signal));
        if (status == EZB_BDB_STATUS_SUCCESS) {
            ESP_LOGI(TAG, "Network steering completed successfully");
            /* Request initial time sync from coordinator */
            smart_entry_request_time_sync();
        } else {
            ESP_LOGW(TAG,
                     "Network steering failed with status(0x%02x), retry in 1s",
                     status);
            alarm_timer_schedule(esp_zigbee_alarm_bdb_commissioning,
                                 EZB_BDB_MODE_NETWORK_STEERING, 1000);
        }
    } break;

    case EZB_ZDO_SIGNAL_DEVICE_ANNCE: {
        const ezb_zdo_signal_device_annce_params_t *dev_annce_params =
            ezb_app_signal_get_params(app_signal);
        ESP_LOGI(TAG, "Device joined/rejoined: short 0x%04hx",
                 dev_annce_params->short_addr);
    } break;

    case EZB_ZDO_SIGNAL_LEAVE_INDICATION: {
        const ezb_zdo_signal_leave_indication_params_t *leave_ind_params =
            ezb_app_signal_get_params(app_signal);
        ESP_LOGI(TAG, "Node 0x%04hx is leaving network",
                 leave_ind_params->short_addr);
        smart_entry_invalidate_clock();
    } break;

    default:
        ESP_LOGD(TAG, "Zigbee APP Signal: %s(0x%02x)",
                 ezb_app_signal_to_string(signal_type), signal_type);
        break;
    }
    return true;
}

static void esp_zigbee_zcl_core_action_handler(
    ezb_zcl_core_action_callback_id_t callback_id, void *message) {
    switch (callback_id) {
    case EZB_ZCL_CORE_READ_ATTR_RSP_CB_ID: {
        ezb_zcl_cmd_read_attr_rsp_message_t *read_rsp =
            (ezb_zcl_cmd_read_attr_rsp_message_t *)message;
        if (!read_rsp || !read_rsp->in.header) {
            break;
        }

        if (read_rsp->in.header->cluster_id == EZB_ZCL_CLUSTER_ID_TIME) {
            uint32_t zcl_time = 0xFFFFFFFF;
            uint8_t time_status = 0x00;
            bool got_time = false;
            bool got_status = false;

            ezb_zcl_read_attr_rsp_variable_t *var = read_rsp->in.variables;
            while (var) {
                if (var->status == EZB_ZCL_STATUS_SUCCESS && var->attr_value) {
                    if (var->attr_id == EZB_ZCL_ATTR_TIME_TIME_ID) {
                        zcl_time = *(uint32_t *)var->attr_value;
                        got_time = true;
                    } else if (var->attr_id ==
                               EZB_ZCL_ATTR_TIME_TIME_STATUS_ID) {
                        time_status = *(uint8_t *)var->attr_value;
                        got_status = true;
                    }
                }
                var = var->next;
            }

            if (got_time && got_status) {
                smart_entry_apply_zcl_time(zcl_time, time_status);
            }
        }
    } break;

    case EZB_ZCL_CORE_DEFAULT_RSP_CB_ID: {
        ezb_zcl_cmd_default_rsp_message_t *default_rsp =
            (ezb_zcl_cmd_default_rsp_message_t *)message;

        if (!default_rsp || !default_rsp->in.header) {
            break;
        }

        uint16_t cluster_id = default_rsp->in.header->cluster_id;
        uint8_t command_id =
            default_rsp->in
                .rsp_to_cmd; /* originating command, verify field name */
        uint8_t status = default_rsp->in.status_code;

        if (status == EZB_ZCL_STATUS_SUCCESS) {
            ESP_LOGD(TAG, "Default Rsp OK: cluster 0x%04x, cmd 0x%02x",
                     cluster_id, command_id);
        } else {
            ESP_LOGW(
                TAG,
                "Default Rsp ERROR: cluster 0x%04x, cmd 0x%02x, status 0x%02x",
                cluster_id, command_id, status);
        }
    } break;

    default:
        ESP_LOGD(TAG, "ZCL Core Action: ID(0x%04lx)",
                 (unsigned long)callback_id);
        break;
    }
}

static esp_err_t esp_zigbee_create_smart_entry_device(void) {
    ezb_af_device_desc_t dev_desc = ezb_af_create_device_desc();
    ezb_af_ep_desc_t ep_desc = NULL;

    /* Basic cluster server */
    ezb_zcl_basic_cluster_server_config_t basic_cfg = {
        .zcl_version = EZB_ZCL_BASIC_ZCL_VERSION_DEFAULT_VALUE,
        .power_source = EZB_ZCL_BASIC_POWER_SOURCE_DEFAULT_VALUE,
    };
    ezb_zcl_cluster_desc_t basic_desc =
        ezb_zcl_basic_create_cluster_desc(&basic_cfg, EZB_ZCL_CLUSTER_SERVER);
    ezb_zcl_basic_cluster_desc_add_attr(basic_desc,
                                        EZB_ZCL_ATTR_BASIC_MANUFACTURER_NAME_ID,
                                        (void *)ESP_MANUFACTURER_NAME);
    ezb_zcl_basic_cluster_desc_add_attr(basic_desc,
                                        EZB_ZCL_ATTR_BASIC_MODEL_IDENTIFIER_ID,
                                        (void *)ESP_MODEL_IDENTIFIER);

    /* Identify cluster server */
    ezb_zcl_identify_cluster_server_config_t identify_cfg = {
        .identify_time = EZB_ZCL_IDENTIFY_IDENTIFY_TIME_DEFAULT_VALUE,
    };
    ezb_zcl_cluster_desc_t identify_desc = ezb_zcl_identify_create_cluster_desc(
        &identify_cfg, EZB_ZCL_CLUSTER_SERVER);

    /* Time cluster client (cluster 0x000A) */
    ezb_zcl_cluster_desc_t time_desc =
        ezb_zcl_time_create_cluster_desc(NULL, EZB_ZCL_CLUSTER_CLIENT);

    /* SmartEntry custom cluster server (cluster 0xFC00) */
    ezb_zcl_custom_cluster_config_t custom_cfg = {
        .cluster_id = SMART_ENTRY_CLUSTER_ID,
        .init_func = esp_zigbee_zcl_smart_entry_server_init,
        .deinit_func = esp_zigbee_zcl_smart_entry_server_deinit,
    };
    ezb_zcl_cluster_desc_t custom_desc =
        ezb_zcl_custom_create_cluster_desc(&custom_cfg, EZB_ZCL_CLUSTER_SERVER);

    /* Endpoint 1 HA Profile */
    ezb_af_ep_config_t ep_config = {
        .ep_id = SMART_ENTRY_ENDPOINT_ID,
        .app_profile_id = EZB_AF_HA_PROFILE_ID,
        .app_device_id = 0x000A, /* Door Lock */
        .app_device_version = 0,
    };
    ep_desc = ezb_af_create_endpoint_desc(&ep_config);

    ESP_ERROR_CHECK(ezb_af_endpoint_add_cluster_desc(ep_desc, basic_desc));
    ESP_ERROR_CHECK(ezb_af_endpoint_add_cluster_desc(ep_desc, identify_desc));
    ESP_ERROR_CHECK(ezb_af_endpoint_add_cluster_desc(ep_desc, time_desc));
    ESP_ERROR_CHECK(ezb_af_endpoint_add_cluster_desc(ep_desc, custom_desc));

    ESP_ERROR_CHECK(ezb_af_device_add_endpoint_desc(dev_desc, ep_desc));
    ESP_ERROR_CHECK(ezb_af_device_desc_register(dev_desc));

    ezb_zcl_core_action_handler_register(esp_zigbee_zcl_core_action_handler);

    return ESP_OK;
}

static esp_err_t esp_zigbee_setup_commissioning(void) {
    ezb_aps_secur_enable_distributed_security(false);
    /* Non-sleepy end device: the Pi sends requests at any time and must not
     * depend on parent polling. Must be set before joining. */
    ezb_nwk_set_rx_on_when_idle(true);
    ESP_ERROR_CHECK(
        ezb_bdb_set_primary_channel_set(ESP_ZIGBEE_PRIMARY_CHANNEL_MASK));
    ESP_ERROR_CHECK(
        ezb_bdb_set_secondary_channel_set(ESP_ZIGBEE_SECONDARY_CHANNEL_MASK));
    ESP_ERROR_CHECK(ezb_app_signal_add_handler(esp_zigbee_app_signal_handler));
    return ESP_OK;
}

void vCommTask(void *pvParameters) {
    ESP_LOGI(TAG, "Starting SmartEntry Zigbee v1 Communication Task");

    /* 1. Run cryptographic self-test against reference test vector */
    if (!smart_entry_crypto_self_test()) {
        ESP_LOGE(TAG, "Cryptographic self-test failed! Aborting startup.");
        vTaskDelete(NULL);
        return;
    }

    /* 2. Initialize application subsystems */
    smart_entry_storage_init();
    smart_entry_time_init();
    smart_entry_event_init();
    smart_entry_lock_init();

    /* 3. Initialize Zigbee stack */
    esp_zigbee_config_t config = ESP_ZIGBEE_DEFAULT_CONFIG();
    ESP_ERROR_CHECK(esp_zigbee_init(&config));
    ESP_ERROR_CHECK(esp_zigbee_setup_commissioning());
    ESP_ERROR_CHECK(esp_zigbee_create_smart_entry_device());
    ESP_ERROR_CHECK(esp_zigbee_start(false));

    /* 4. Setup periodic time sync timer */
    esp_timer_create_args_t timer_args = {
        .callback = time_sync_timer_cb,
        .name = "time_sync_timer",
    };
    if (esp_timer_create(&timer_args, &s_time_sync_timer) == ESP_OK) {
        esp_timer_start_periodic(s_time_sync_timer, TIME_SYNC_INTERVAL_US);
    }

    ESP_LOGI(TAG, "Launching Zigbee main loop");
    esp_zigbee_launch_mainloop();

    esp_zigbee_deinit();
    vTaskDelete(NULL);
}
