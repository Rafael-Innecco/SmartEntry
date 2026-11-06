#include "time_sync.h"
#include <sys/time.h>
#include "esp_log.h"
#include "esp_zigbee.h"

static const char *TAG = "SE_TIME_SYNC";

static bool s_clock_reliable = false;

void smart_entry_time_init(void) {
    s_clock_reliable = false;
    ESP_LOGI(TAG, "Time sync initialized (clock currently untrusted)");
}

bool smart_entry_is_clock_reliable(void) {
    return s_clock_reliable;
}

uint32_t smart_entry_get_unix_time(void) {
    struct timeval tv;
    gettimeofday(&tv, NULL);
    return (uint32_t)tv.tv_sec;
}

void smart_entry_invalidate_clock(void) {
    s_clock_reliable = false;
    ESP_LOGW(TAG, "Clock marked unreliable");
}

bool smart_entry_apply_zcl_time(uint32_t zcl_time, uint8_t time_status) {
    /* Sem NTP, Pi retorna time=0xFFFFFFFF, timeStatus=0 */
    /* Com NTP, timeStatus=3 (master + synchronized) */
    if (zcl_time == 0xFFFFFFFF || (time_status & 0x03) != 0x03) {
        s_clock_reliable = false;
        ESP_LOGW(TAG, "Coordinator clock untrusted: zcl_time=0x%08lx, status=0x%02x",
                 (unsigned long)zcl_time, time_status);
        return false;
    }

    uint64_t unix_time = (uint64_t)zcl_time + ZCL_EPOCH_TO_UNIX_OFFSET;
    struct timeval tv = {
        .tv_sec = (time_t)unix_time,
        .tv_usec = 0
    };
    settimeofday(&tv, NULL);
    s_clock_reliable = true;

    ESP_LOGI(TAG, "Clock synchronized: Unix timestamp %lu (status 0x%02x)",
             (unsigned long)unix_time, time_status);
    return true;
}

void smart_entry_request_time_sync(void) {
    uint16_t attr_ids[] = {
        EZB_ZCL_ATTR_TIME_TIME_ID,        /* 0x0000 */
        EZB_ZCL_ATTR_TIME_TIME_STATUS_ID  /* 0x0001 */
    };

    ezb_zcl_read_attr_cmd_t cmd_req = {
        .cmd_ctrl = {
            .dst_addr = {
                .addr_mode = EZB_ADDR_MODE_SHORT,
                .u = {
                    .short_addr = 0x0000, /* Coordinator short address */
                },
            },
            .dst_ep = SMART_ENTRY_ENDPOINT_ID,
            .src_ep = SMART_ENTRY_ENDPOINT_ID,
            .cluster_id = EZB_ZCL_CLUSTER_ID_TIME,
            .manuf_code = EZB_ZCL_STD_MANUF_CODE,
            .fc = {
                .manuf_specific = false,
                .direction = EZB_ZCL_CMD_DIRECTION_TO_SRV,
                .dis_default_rsp = true,
            },
        },
        .payload = {
            .attr_number = 2,
            .attr_field = attr_ids,
        },
    };

    ezb_err_t err = ezb_zcl_read_attr_cmd_req(&cmd_req);
    if (err != EZB_ERR_NONE) {
        ESP_LOGW(TAG, "Failed to send read Time attribute request: 0x%02x", err);
    } else {
        ESP_LOGI(TAG, "Requested Time attributes (time & timeStatus) from coordinator");
    }
}
