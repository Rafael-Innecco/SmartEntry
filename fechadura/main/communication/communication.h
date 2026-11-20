#pragma once

#include "esp_zigbee.h"
#include "protocol.h"

#define ESP_ZIGBEE_PRIMARY_CHANNEL_MASK                                        \
    (1U << CONFIG_ZB_EXAMPLE_PRIMARY_CHANNEL)
#define ESP_ZIGBEE_SECONDARY_CHANNEL_MASK                                      \
    CONFIG_ZB_EXAMPLE_SECONDARY_CHANNEL_MASK

#define ESP_ZIGBEE_SMART_ENTRY_EP_ID (SMART_ENTRY_ENDPOINT_ID)

#define ESP_ZIGBEE_STORAGE_PARTITION_NAME "nvs"
#define ESP_MANUFACTURER_NAME                                                  \
    "\x09"                                                                     \
    "ESPRESSIF"
#define ESP_MODEL_IDENTIFIER "\x07" CONFIG_IDF_TARGET

#define CONFIG_ZB_EXAMPLE_SECONDARY_CHANNEL_MASK 0x07FFF800
#define CONFIG_ZB_EXAMPLE_PRIMARY_CHANNEL 13

#define ESP_ZIGBEE_ZC_CONFIG()                                                 \
    {                                                                          \
        .device_type = EZB_NWK_DEVICE_TYPE_END_DEVICE,                         \
        .install_code_policy = false,                                          \
        .zed_config =                                                          \
            {                                                                  \
                .ed_timeout = EZB_NWK_ED_TIMEOUT_64MIN,                        \
                .keep_alive = 3000,                                            \
            },                                                                 \
    }

#if CONFIG_SOC_IEEE802154_SUPPORTED
#define ESP_ZIGBEE_PLATFORM_CONFIG()                                           \
    {                                                                          \
        .storage_partition_name = ESP_ZIGBEE_STORAGE_PARTITION_NAME,           \
        .radio_config =                                                        \
            {                                                                  \
                .radio_mode = ESP_ZIGBEE_RADIO_MODE_NATIVE,                    \
            },                                                                 \
    }
#else
#warning                                                                       \
    "The example is not for IEEE 802.15.4-disabled SoC usage, please refer to esp_zigbee_gateway for RCP configuration"
#endif

#define ESP_ZIGBEE_DEFAULT_CONFIG()                                            \
    {                                                                          \
        .device_config = ESP_ZIGBEE_ZC_CONFIG(),                               \
        .platform_config = ESP_ZIGBEE_PLATFORM_CONFIG(),                       \
    };

void vCommTask(void *pvParameters);
