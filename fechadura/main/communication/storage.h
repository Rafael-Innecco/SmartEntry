#ifndef SMART_ENTRY_STORAGE_H
#define SMART_ENTRY_STORAGE_H

#include "protocol.h"
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    uint8_t flags; /* Bit 0: occupied, Bit 1: TOTP, Bit 2: RFID */
    uint8_t totp_secret[SMART_ENTRY_APP_KEY_LEN]; /* 32 bytes */
    uint64_t last_used_step; /* Anti-replay for TOTP timesteps */
} smart_entry_slot_t;

/**
 * @brief Initialize NVS storage and load state into RAM caches.
 *
 * @return true on success, false on NVS failure.
 */
bool smart_entry_storage_init(void);

/**
 * @brief Get the 32-byte application HMAC key.
 */
bool smart_entry_storage_get_app_key(uint8_t out_key[SMART_ENTRY_APP_KEY_LEN]);

/**
 * @brief Provision a new 32-byte application HMAC key into NVS.
 */
bool smart_entry_storage_set_app_key(
    const uint8_t key[SMART_ENTRY_APP_KEY_LEN]);

/**
 * @brief Get the last persisted request counter.
 */
uint32_t smart_entry_storage_get_counter(void);

/**
 * @brief Persist a new command counter to NVS atomically.
 *
 * @param counter New counter (must be strictly greater than previous).
 * @return true on successful persist, false on failure.
 */
bool smart_entry_storage_persist_counter(uint32_t counter);

/**
 * @brief Retrieve slot information.
 *
 * @param slot_idx Slot index (0..9).
 * @param out_slot Pointer to store slot info.
 * @return true if valid slot index, false otherwise.
 */
bool smart_entry_storage_get_slot(uint8_t slot_idx,
                                  smart_entry_slot_t *out_slot);

/**
 * @brief Configure and persist a user slot with a 32-byte TOTP secret.
 *
 * @param slot_idx Slot index (0..9).
 * @param secret 32-byte TOTP secret.
 * @return true on success, false if slot index invalid or flash write fails.
 */
bool smart_entry_storage_set_slot(uint8_t slot_idx,
                                  const uint8_t secret[SMART_ENTRY_APP_KEY_LEN],
                                  const char *name);

/**
 * @brief Clear a user slot from storage.
 *
 * @param slot_idx Slot index (0..9).
 * @return true on success, false if slot index invalid or flash write fails.
 */
bool smart_entry_storage_clear_slot(uint8_t slot_idx);

/**
 * @brief Get the 10-byte slots bitmap for listSlots response.
 *
 * @param out_slots Array of 10 bytes to fill.
 */
void smart_entry_storage_get_slots_bitmap(
    uint8_t out_slots[SMART_ENTRY_MAX_SLOTS + 1]);

/**
 * @brief Cache the response for the last executed command to serve replay
 * queries.
 */
void smart_entry_storage_cache_response(uint32_t counter,
                                        const uint8_t *rsp_buf, size_t rsp_len);

/**
 * @brief Retrieve the cached response for an exact duplicate command.
 *
 * @return true if cache matches counter, false otherwise.
 */
bool smart_entry_storage_get_cached_response(uint32_t counter, uint8_t *out_buf,
                                             size_t *out_len);

/**
 * @brief Update the last authenticated TOTP timestep for a slot.
 */
bool smart_entry_storage_update_slot_step(uint8_t slot_idx, uint64_t step);

#ifdef __cplusplus
}
#endif

#endif /* SMART_ENTRY_STORAGE_H */
