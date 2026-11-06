#ifndef DATA_STREAM_SERVER_H
#define DATA_STREAM_SERVER_H

#include <stdint.h>
#include "esp_zigbee.h"
#include "protocol.h"

#ifdef __cplusplus
extern "C" {
#endif

void esp_zigbee_zcl_smart_entry_server_init(uint8_t ep_id);
void esp_zigbee_zcl_smart_entry_server_deinit(uint8_t ep_id);

#ifdef __cplusplus
}
#endif

#endif /* DATA_STREAM_SERVER_H */
