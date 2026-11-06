#include "storage.h"
#include <string.h>
#include <stdio.h>
#include "nvs_flash.h"
#include "nvs.h"
#include "esp_log.h"

static const char *TAG = "SE_STORAGE";
static const char *NVS_NAMESPACE = "se_storage";

/* In-memory cached state */
static uint8_t s_app_key[SMART_ENTRY_APP_KEY_LEN];
static bool s_has_key = false;
static uint32_t s_counter = 0;
static smart_entry_slot_t s_slots[SMART_ENTRY_MAX_SLOTS];

/* Replay cache for the last executed command */
static uint32_t s_cached_counter = 0;
static uint8_t s_cached_response[SMART_ENTRY_MAX_ENVELOPE_LEN];
static size_t s_cached_len = 0;

/* Default test key matching lock-protocol-v1.json (used if NVS has no key provisioned) */
static const uint8_t DEFAULT_TEST_KEY[SMART_ENTRY_APP_KEY_LEN] = {
    0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
    0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
    0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17,
    0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f
};

bool smart_entry_storage_init(void) {
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
        (void)nvs_set_blob(handle, "app_key", s_app_key, SMART_ENTRY_APP_KEY_LEN);
    }

    /* Load Counter */
    err = nvs_get_u32(handle, "counter", &s_counter);
    if (err != ESP_OK) {
        s_counter = 0;
    }

    /* Load Slots */
    memset(s_slots, 0, sizeof(s_slots));
    for (int i = 0; i < SMART_ENTRY_MAX_SLOTS; i++) {
        char key_name[16];
        snprintf(key_name, sizeof(key_name), "slot_%d", i);

        size_t slot_len = sizeof(smart_entry_slot_t);
        err = nvs_get_blob(handle, key_name, &s_slots[i], &slot_len);
        if (err != ESP_OK || slot_len != sizeof(smart_entry_slot_t)) {
            s_slots[i].flags = 0;
            memset(s_slots[i].totp_secret, 0, SMART_ENTRY_APP_KEY_LEN);
            s_slots[i].last_used_step = 0;
        }
    }

    nvs_commit(handle);
    nvs_close(handle);

    ESP_LOGI(TAG, "Storage initialized. Current counter: %lu", (unsigned long)s_counter);
    return true;
}

bool smart_entry_storage_get_app_key(uint8_t out_key[SMART_ENTRY_APP_KEY_LEN]) {
    if (!s_has_key) {
        return false;
    }
    memcpy(out_key, s_app_key, SMART_ENTRY_APP_KEY_LEN);
    return true;
}

bool smart_entry_storage_set_app_key(const uint8_t key[SMART_ENTRY_APP_KEY_LEN]) {
    if (!key) return false;

    nvs_handle_t handle;
    if (nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle) != ESP_OK) return false;

    esp_err_t err = nvs_set_blob(handle, "app_key", key, SMART_ENTRY_APP_KEY_LEN);
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

uint32_t smart_entry_storage_get_counter(void) {
    return s_counter;
}

bool smart_entry_storage_persist_counter(uint32_t counter) {
    nvs_handle_t handle;
    if (nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle) != ESP_OK) return false;

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

bool smart_entry_storage_get_slot(uint8_t slot_idx, smart_entry_slot_t *out_slot) {
    if (slot_idx >= SMART_ENTRY_MAX_SLOTS || !out_slot) {
        return false;
    }
    memcpy(out_slot, &s_slots[slot_idx], sizeof(smart_entry_slot_t));
    return true;
}

bool smart_entry_storage_set_slot(uint8_t slot_idx, const uint8_t secret[SMART_ENTRY_APP_KEY_LEN]) {
    if (slot_idx >= SMART_ENTRY_MAX_SLOTS || !secret) {
        return false;
    }

    smart_entry_slot_t new_slot;
    new_slot.flags = SMART_ENTRY_SLOT_FLAG_OCCUPIED | SMART_ENTRY_SLOT_FLAG_TOTP;
    memcpy(new_slot.totp_secret, secret, SMART_ENTRY_APP_KEY_LEN);
    new_slot.last_used_step = 0;

    nvs_handle_t handle;
    if (nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle) != ESP_OK) return false;

    char key_name[16];
    snprintf(key_name, sizeof(key_name), "slot_%d", slot_idx);

    esp_err_t err = nvs_set_blob(handle, key_name, &new_slot, sizeof(smart_entry_slot_t));
    if (err == ESP_OK) {
        err = nvs_commit(handle);
        if (err == ESP_OK) {
            s_slots[slot_idx] = new_slot;
        }
    }
    nvs_close(handle);
    return (err == ESP_OK);
}

bool smart_entry_storage_clear_slot(uint8_t slot_idx) {
    if (slot_idx >= SMART_ENTRY_MAX_SLOTS) {
        return false;
    }

    nvs_handle_t handle;
    if (nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle) != ESP_OK) return false;

    char key_name[16];
    snprintf(key_name, sizeof(key_name), "slot_%d", slot_idx);

    esp_err_t err = nvs_erase_key(handle, key_name);
    if (err == ESP_OK || err == ESP_ERR_NVS_NOT_FOUND) {
        err = nvs_commit(handle);
        memset(&s_slots[slot_idx], 0, sizeof(smart_entry_slot_t));
    }
    nvs_close(handle);
    return (err == ESP_OK || err == ESP_ERR_NVS_NOT_FOUND);
}

void smart_entry_storage_get_slots_bitmap(uint8_t out_slots[SMART_ENTRY_MAX_SLOTS]) {
    for (int i = 0; i < SMART_ENTRY_MAX_SLOTS; i++) {
        out_slots[i] = s_slots[i].flags;
    }
}

void smart_entry_storage_cache_response(uint32_t counter, const uint8_t *rsp_buf, size_t rsp_len) {
    if (!rsp_buf || rsp_len > sizeof(s_cached_response)) return;
    s_cached_counter = counter;
    memcpy(s_cached_response, rsp_buf, rsp_len);
    s_cached_len = rsp_len;
}

bool smart_entry_storage_get_cached_response(uint32_t counter, uint8_t *out_buf, size_t *out_len) {
    if (s_cached_counter != 0 && s_cached_counter == counter && s_cached_len > 0) {
        memcpy(out_buf, s_cached_response, s_cached_len);
        *out_len = s_cached_len;
        return true;
    }
    return false;
}

bool smart_entry_storage_update_slot_step(uint8_t slot_idx, uint64_t step) {
    if (slot_idx >= SMART_ENTRY_MAX_SLOTS) return false;

    s_slots[slot_idx].last_used_step = step;

    nvs_handle_t handle;
    if (nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle) != ESP_OK) return false;

    char key_name[16];
    snprintf(key_name, sizeof(key_name), "slot_%d", slot_idx);

    esp_err_t err = nvs_set_blob(handle, key_name, &s_slots[slot_idx], sizeof(smart_entry_slot_t));
    if (err == ESP_OK) {
        nvs_commit(handle);
    }
    nvs_close(handle);
    return true;
}
