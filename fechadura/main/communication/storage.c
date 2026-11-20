#include "storage.h"
#include "../db.h"
#include "esp_err.h"
#include "esp_log.h"
#include "nvs.h"
#include "nvs_flash.h"
#include "protocol.h"
#include <stdint.h>
#include <stdio.h>
#include <string.h>

static const char *TAG = "SE_STORAGE";
static const char *NVS_NAMESPACE = "se_storage";

/* In-memory cached state */
static uint8_t s_app_key[SMART_ENTRY_APP_KEY_LEN];
static bool s_has_key = false;
static uint32_t s_counter = 0;
static uint64_t s_last_used_step[SMART_ENTRY_MAX_SLOTS];

/* Replay cache for the last executed command */
static uint32_t s_cached_counter = 0;
static uint8_t s_cached_response[SMART_ENTRY_MAX_ENVELOPE_LEN];
static size_t s_cached_len = 0;

/* Default test key matching lock-protocol-v1.json (used if NVS has no key
 * provisioned) */
static const uint8_t DEFAULT_TEST_KEY[SMART_ENTRY_APP_KEY_LEN] = {
    0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a,
    0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15,
    0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f};

bool smart_entry_storage_init(void) {
    esp_err_t db_err = initDb();
    if (db_err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to initialize DB: %s", esp_err_to_name(db_err));
        return false;
    }

    memset(s_last_used_step, 0, sizeof(s_last_used_step));

    nvs_handle_t handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to open NVS namespace: %s", esp_err_to_name(err));
        return false;
    }

    /* Load App Key */
    size_t key_len = sizeof(s_app_key);
    err = nvs_get_blob(handle, "app_key", s_app_key, &key_len);
    if (err == ESP_OK && key_len == SMART_ENTRY_APP_KEY_LEN) {
        s_has_key = true;
    } else {
        /* Fall back to default test key */
        memcpy(s_app_key, DEFAULT_TEST_KEY, SMART_ENTRY_APP_KEY_LEN);
        s_has_key = true;
        (void)nvs_set_blob(handle, "app_key", s_app_key,
                           SMART_ENTRY_APP_KEY_LEN);
    }

    /* Load Counter */
    err = nvs_get_u32(handle, "counter", &s_counter);
    if (err != ESP_OK) {
        s_counter = 0;
    }

    nvs_commit(handle);
    nvs_close(handle);

    ESP_LOGI(TAG, "Storage initialized. Current counter: %lu",
             (unsigned long)s_counter);
    return true;
}

bool smart_entry_storage_get_app_key(uint8_t out_key[SMART_ENTRY_APP_KEY_LEN]) {
    if (!s_has_key) {
        return false;
    }
    memcpy(out_key, s_app_key, SMART_ENTRY_APP_KEY_LEN);
    return true;
}

bool smart_entry_storage_set_app_key(
    const uint8_t key[SMART_ENTRY_APP_KEY_LEN]) {
    if (!key)
        return false;

    nvs_handle_t handle;
    if (nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle) != ESP_OK)
        return false;

    esp_err_t err =
        nvs_set_blob(handle, "app_key", key, SMART_ENTRY_APP_KEY_LEN);
    if (err == ESP_OK) {
        err = nvs_commit(handle);
        if (err == ESP_OK) {
            memcpy(s_app_key, key, SMART_ENTRY_APP_KEY_LEN);
            s_has_key = true;
        }
    }
    nvs_close(handle);
    return (err == ESP_OK);
}

uint32_t smart_entry_storage_get_counter(void) { return s_counter; }

bool smart_entry_storage_persist_counter(uint32_t counter) {
    nvs_handle_t handle;
    if (nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle) != ESP_OK)
        return false;

    esp_err_t err = nvs_set_u32(handle, "counter", counter);
    if (err == ESP_OK) {
        err = nvs_commit(handle);
        if (err == ESP_OK) {
            s_counter = counter;
        }
    }
    nvs_close(handle);
    return (err == ESP_OK);
}

bool smart_entry_storage_get_slot(uint8_t slot_idx,
                                  smart_entry_slot_t *out_slot) {
    if (slot_idx >= SMART_ENTRY_MAX_SLOTS || !out_slot) {
        return false;
    }

    DbUser record;
    esp_err_t ret = loadUser(slot_idx, &record);
    if (ret == ESP_OK) {
        out_slot->flags =
            SMART_ENTRY_SLOT_FLAG_OCCUPIED | SMART_ENTRY_SLOT_FLAG_TOTP;
        memcpy(out_slot->totp_secret, record.key, SMART_ENTRY_APP_KEY_LEN);
        out_slot->last_used_step = s_last_used_step[slot_idx];
        return true;
    } else if (ret == ESP_ERR_NVS_NOT_FOUND) {
        memset(out_slot, 0, sizeof(smart_entry_slot_t));
        return true;
    }

    ESP_LOGE(TAG, "Error loading user %u: %s", slot_idx, esp_err_to_name(ret));
    return false;
}

bool smart_entry_storage_set_slot(uint8_t slot_idx,
                                  const uint8_t secret[SMART_ENTRY_APP_KEY_LEN],
                                  const char *name) {
    if (slot_idx >= SMART_ENTRY_SLOT_UNASSIGNED || !secret) {
        return false;
    }

    DbUser user;
    memset(&user, 0, sizeof(user));
    user.id = slot_idx;

    if (name && name[0] != '\0') {
        strncpy(user.name, name, sizeof(user.name) - 1);
        user.name[sizeof(user.name) - 1] = '\0';
    } else {
        snprintf(user.name, sizeof(user.name), "Slot %u", slot_idx);
    }

    memcpy(user.key, secret, SMART_ENTRY_APP_KEY_LEN);

    esp_err_t err = storeUser(slot_idx, &user);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to store user %u: %s", slot_idx,
                 esp_err_to_name(err));
        return false;
    }

    s_last_used_step[slot_idx] = 0;
    return true;
}

bool smart_entry_storage_clear_slot(uint8_t slot_idx) {
    if (slot_idx >= SMART_ENTRY_MAX_SLOTS) {
        return false;
    }

    esp_err_t err = eraseUser(slot_idx);
    if (err != ESP_OK && err != ESP_ERR_NVS_NOT_FOUND) {
        ESP_LOGE(TAG, "Failed to erase user %u: %s", slot_idx,
                 esp_err_to_name(err));
        return false;
    }

    s_last_used_step[slot_idx] = 0;
    return true;
}

void smart_entry_storage_get_slots_bitmap(
    uint8_t out_slots[SMART_ENTRY_MAX_SLOTS + 1]) {
    if (!out_slots) {
        return;
    }

    memset(out_slots + 1, SMART_ENTRY_SLOT_UNASSIGNED, SMART_ENTRY_MAX_SLOTS);

    UserIterator userIt;
    esp_err_t ret = initUserIter(&userIt);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Error initializing user iterator: %s",
                 esp_err_to_name(ret));
        return;
    }

    uint8_t count = 0;
    DbUser rec;

    while (nextUser(&userIt) == ESP_OK && count < SMART_ENTRY_MAX_SLOTS) {
        if (loadUser(userIt.id, &rec) == ESP_OK) {
            out_slots[count + 1] = userIt.id;
            count++;
        }
    }

    out_slots[0] = count;
}

void smart_entry_storage_cache_response(uint32_t counter,
                                        const uint8_t *rsp_buf,
                                        size_t rsp_len) {
    if (!rsp_buf || rsp_len > sizeof(s_cached_response))
        return;
    s_cached_counter = counter;
    memcpy(s_cached_response, rsp_buf, rsp_len);
    s_cached_len = rsp_len;
}

bool smart_entry_storage_get_cached_response(uint32_t counter, uint8_t *out_buf,
                                             size_t *out_len) {
    if (s_cached_counter != 0 && s_cached_counter == counter &&
        s_cached_len > 0) {
        memcpy(out_buf, s_cached_response, s_cached_len);
        *out_len = s_cached_len;
        return true;
    }
    return false;
}

bool smart_entry_storage_update_slot_step(uint8_t slot_idx, uint64_t step) {
    if (slot_idx >= SMART_ENTRY_MAX_SLOTS)
        return false;

    s_last_used_step[slot_idx] = step;
    return true;
}
