#ifndef SMART_ENTRY_LOCK_CONTROLLER_H
#define SMART_ENTRY_LOCK_CONTROLLER_H

#include <stdint.h>
#include <stdbool.h>
#include "protocol.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Initialize lock controller state.
 */
void smart_entry_lock_init(void);

/**
 * @brief Get the current physical lock state.
 *
 * @return 0 for unlocked, 1 for locked.
 */
uint8_t smart_entry_get_lock_state(void);

/**
 * @brief Perform remote unlock operation (from Opcode 4 unlock).
 *
 * Triggers physical mechanism and updates state.
 *
 * @return true if unlock initiated successfully, false on mechanism failure.
 */
bool smart_entry_perform_unlock(void);

/**
 * @brief Verify keypad entry of the format: <slot><6-digit code>#.
 *
 * Checks time validity (+/- 1 period = 30s) and enforces anti-replay.
 * Dispatches an access event to coordinator.
 *
 * @param slot_idx Slot index (0..9).
 * @param code_digits Array of 6 uint8_t digits (each 0..9).
 * @return true if access granted, false if rejected.
 */
bool smart_entry_check_keypad_code(uint8_t slot_idx, const uint8_t code_digits[6]);

#ifdef __cplusplus
}
#endif

#endif /* SMART_ENTRY_LOCK_CONTROLLER_H */
