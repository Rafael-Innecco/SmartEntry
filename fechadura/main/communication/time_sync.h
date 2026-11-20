#ifndef SMART_ENTRY_TIME_SYNC_H
#define SMART_ENTRY_TIME_SYNC_H

#include "protocol.h"
#include <stdbool.h>
#include <stdint.h>
#include <time.h>

#ifdef __cplusplus
extern "C" {
#endif

#define ZCL_EPOCH_TO_UNIX_OFFSET                                               \
    946684800ULL /* Seconds between 1970-01-01 and 2000-01-01 */

/**
 * @brief Initialize time sync subsystem.
 */
void smart_entry_time_init(void);

/**
 * @brief Check if the current system clock is synchronized and reliable.
 *
 * @return true if clock was synchronized with coordinator (timeStatus == 3) and
 * valid.
 */
bool smart_entry_is_clock_reliable(void);

/**
 * @brief Get the current Unix UTC epoch in seconds.
 *
 * @return current seconds since 1970-01-01.
 */
uint32_t smart_entry_get_unix_time(void);

/**
 * @brief Update device clock from ZCL Time response.
 *
 * @param zcl_time 32-bit ZCL UTC seconds (since 2000-01-01).
 * @param time_status 8-bit ZCL timeStatus bitmap.
 * @return true if clock accepted as reliable, false otherwise.
 */
bool smart_entry_apply_zcl_time(uint32_t zcl_time, uint8_t time_status);

/**
 * @brief Invalidate clock reliability (e.g., after communication loss or
 * reboot).
 */
void smart_entry_invalidate_clock(void);

/**
 * @brief Send ZCL Read Attributes request for cluster 0x000A to coordinator.
 */
void smart_entry_request_time_sync(void);

#ifdef __cplusplus
}
#endif

#endif /* SMART_ENTRY_TIME_SYNC_H */
