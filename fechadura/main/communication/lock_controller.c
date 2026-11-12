#include "lock_controller.h"
#include "esp_log.h"
#include "event_manager.h"
#include "storage.h"
#include "time_sync.h"
#include "../totp/totp.h"
#include "../lock.h"
#include <string.h>

static const char *TAG = "SE_LOCK_CTRL";
static uint8_t s_lock_state = SMART_ENTRY_DOOR_LOCKED;

void smart_entry_lock_init(void) {
    s_lock_state = SMART_ENTRY_DOOR_LOCKED;
    ESP_LOGI(TAG, "Lock controller initialized (state: LOCKED)");
}

uint8_t smart_entry_get_lock_state(void) { return s_lock_state; }

bool smart_entry_perform_unlock(void) {
    ESP_LOGI(TAG, "Actuating physical unlock mechanism...");
    s_lock_state = SMART_ENTRY_DOOR_UNLOCKED;

    openDoor();

    /* Notify coordinator of status change */
    smart_entry_send_status_event(s_lock_state);

    return true;
}

bool smart_entry_check_keypad_code(uint8_t slot_idx,
                                   const uint8_t code_digits[6]) {
    if (slot_idx >= SMART_ENTRY_MAX_SLOTS || !code_digits) {
        ESP_LOGW(TAG, "Invalid slot index or code buffer");
        smart_entry_send_access_event(slot_idx, SMART_ENTRY_ACCESS_METHOD_TOTP,
                                      SMART_ENTRY_ACCESS_RESULT_FAILURE);
        return false;
    }

    smart_entry_slot_t slot;
    if (!smart_entry_storage_get_slot(slot_idx, &slot) ||
        !(slot.flags & SMART_ENTRY_SLOT_FLAG_OCCUPIED) ||
        !(slot.flags & SMART_ENTRY_SLOT_FLAG_TOTP)) {
        ESP_LOGW(TAG, "Slot %d not occupied with TOTP", slot_idx);
        smart_entry_send_access_event(slot_idx, SMART_ENTRY_ACCESS_METHOD_TOTP,
                                      SMART_ENTRY_ACCESS_RESULT_FAILURE);
        return false;
    }

    uint32_t now = smart_entry_get_unix_time();
    uint64_t current_step = now / 30;

    /* Check tolerance +/- 1 period (30s) */
    uint64_t candidate_steps[3] = {current_step, current_step - 1,
                                   current_step + 1};
    bool matched = false;
    uint64_t matched_step = 0;

    for (int k = 0; k < 3; k++) {
        uint64_t step = candidate_steps[k];
        uint8_t expected_digits[TOTP_CODELEN];
        uint64_t sim_time = step * 30;

        compute_totp(slot.totp_secret, sim_time, expected_digits);

        if (memcmp(expected_digits, code_digits, TOTP_CODELEN) == 0) {
            matched = true;
            matched_step = step;
            break;
        }
    }

    if (!matched) {
        ESP_LOGW(TAG, "Keypad code mismatch for slot %d", slot_idx);
        smart_entry_send_access_event(slot_idx, SMART_ENTRY_ACCESS_METHOD_TOTP,
                                      SMART_ENTRY_ACCESS_RESULT_FAILURE);
        return false;
    }

    /* Anti-replay: code must not be reused within the same or prior timestep */
    if (matched_step <= slot.last_used_step) {
        ESP_LOGW(
            TAG,
            "Replayed TOTP code rejected for slot %d (step %llu <= last %llu)",
            slot_idx, (unsigned long long)matched_step,
            (unsigned long long)slot.last_used_step);
        smart_entry_send_access_event(slot_idx, SMART_ENTRY_ACCESS_METHOD_TOTP,
                                      SMART_ENTRY_ACCESS_RESULT_FAILURE);
        return false;
    }

    /* Update anti-replay step */
    smart_entry_storage_update_slot_step(slot_idx, matched_step);

    ESP_LOGI(TAG, "Access GRANTED for slot %d", slot_idx);
    smart_entry_send_access_event(slot_idx, SMART_ENTRY_ACCESS_METHOD_TOTP,
                                  SMART_ENTRY_ACCESS_RESULT_SUCCESS);
    smart_entry_perform_unlock();
    return true;
}
