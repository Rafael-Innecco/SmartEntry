#ifndef SMART_ENTRY_EVENT_MANAGER_H
#define SMART_ENTRY_EVENT_MANAGER_H

#include "protocol.h"
#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Initialize the event manager subsystem.
 */
void smart_entry_event_init(void);

/**
 * @brief Adopt a new session challenge from a valid listSlots request.
 *
 * Resets the session sequence counter to 1 and marks session active.
 *
 * @param session_8B 8-byte challenge from coordinator.
 */
void smart_entry_event_adopt_session(
    const uint8_t session_8B[SMART_ENTRY_SESSION_CHALLENGE_LEN]);

/**
 * @brief Check if an event session is currently active.
 */
bool smart_entry_event_is_session_active(void);

/**
 * @brief Send a Type 1 (Status) event to coordinator.
 *
 * @param locked 0 if door unlocked, 1 if door locked.
 * @return true if event formatted and queued/sent, false if no active session
 * or transmission error.
 */
bool smart_entry_send_status_event(uint8_t locked);

/**
 * @brief Send a Type 2 (Access) event to coordinator.
 *
 * @param slot Slot number 0..9 or 0xFF if unknown.
 * @param method 0 for TOTP, 1 for RFID.
 * @param result 0 for success, 1 for failure.
 * @return true if event formatted and queued/sent, false if no active session
 * or transmission error.
 */
bool smart_entry_send_access_event(uint8_t slot, uint8_t method,
                                   uint8_t result);

#ifdef __cplusplus
}
#endif

#endif /* SMART_ENTRY_EVENT_MANAGER_H */
