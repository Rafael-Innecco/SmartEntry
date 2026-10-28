#include <stdio.h>
#include "esp_log.h"
#include "nvs_flash.h"
#include "nvs.h"
#include <stdlib.h>

#include "db.h"

#define TAG "db"

#define USERS_NAMESPACE "users"
#define MSGCOUNTER_NAMESPACE "msgcount"
#define MSGCOUNTER_KEY "count"

static nvs_handle_t users_db_handle;
static nvs_handle_t msgcounter_db_handle;

static void userKey(uint8_t id, char key[NVS_KEY_NAME_MAX_SIZE]) {
    snprintf(key, NVS_KEY_NAME_MAX_SIZE, "%u", id);
}

esp_err_t initDb(void) {
    esp_err_t err = nvs_flash_init();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to init flash: %s", esp_err_to_name(err));
        return err;
    }

    err = nvs_open(USERS_NAMESPACE, NVS_READWRITE, &users_db_handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to open namespace %s: %s", USERS_NAMESPACE, esp_err_to_name(err));
        return err;
    }

    err = nvs_open(MSGCOUNTER_NAMESPACE, NVS_READWRITE, &msgcounter_db_handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to open namespace %s: %s", MSGCOUNTER_NAMESPACE, esp_err_to_name(err));
        return err;
    }

    // initialize msgcounter if it's not initialized
    err = nvs_find_key(msgcounter_db_handle, MSGCOUNTER_KEY, NULL);
    if (err == ESP_ERR_NVS_NOT_FOUND) {
        ESP_LOGI(TAG, "initializing msg counter");
        nvs_set_u64(msgcounter_db_handle, MSGCOUNTER_KEY, 0);
    } else if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to read msgcounter %s: %s", MSGCOUNTER_NAMESPACE, esp_err_to_name(err));
        return err;
    }

    // TEST USER:
    //char* name = "Norbit";
    //uint8_t key[32] = {
    //    123, 42, 69, 67, 123, 42, 69, 67, 123, 42, 69, 67, 123, 42, 69, 67,
    //    123, 42, 69, 67, 123, 42, 69, 67, 123, 42, 69, 67, 123, 42, 69, 67,
    //};
    //uint8_t id = 69;
    //DbUser dummy;
    //dummy.id = id;
    //memcpy(&dummy.name, name, strlen(name)+1);
    //memcpy(&dummy.key, &key, sizeof(key));

    //ESP_ERROR_CHECK(storeUser(id, &dummy));
    return err;
}

esp_err_t storeUser(uint8_t id, DbUser *record) {
    char key[NVS_KEY_NAME_MAX_SIZE];
    userKey(id, key);

    record->id = id;
    esp_err_t err = nvs_set_blob(users_db_handle, key, record, sizeof(*record));
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to store user %u: %s", id, esp_err_to_name(err));
        return err;
    }
    return nvs_commit(users_db_handle);
}

esp_err_t eraseUser(uint8_t id) {
    char key[NVS_KEY_NAME_MAX_SIZE];
    userKey(id, key);

    esp_err_t err = nvs_erase_key(users_db_handle, key);
    if (err != ESP_OK) {
        return err;
    }
    return nvs_commit(users_db_handle);
}

esp_err_t loadUser(uint8_t id, DbUser *record) {
    char key[NVS_KEY_NAME_MAX_SIZE];
    userKey(id, key);

    size_t length = sizeof(*record);
    esp_err_t err = nvs_get_blob(users_db_handle, key, record, &length);
    if (err != ESP_OK) {
        return err;
    }
    if (length != sizeof(*record)) {
        ESP_LOGE(TAG, "User %u has unexpected size %u", id, (unsigned) length);
        return ESP_ERR_INVALID_SIZE;
    }
    record->id = id;
    return ESP_OK;
}

esp_err_t initUserIter(UserIterator* iter) {
    iter->id = 0;
    iter->next_id = 0;
    return ESP_OK;
}

esp_err_t nextUser(UserIterator* iter) {
    char key[NVS_KEY_NAME_MAX_SIZE];

    for (; iter->next_id <= UINT8_MAX; iter->next_id++) {
        userKey(iter->next_id, key);
        esp_err_t err = nvs_find_key(users_db_handle, key, NULL);
        if (err == ESP_OK) {
            iter->id = iter->next_id++;
            return ESP_OK;
        }
        if (err != ESP_ERR_NVS_NOT_FOUND) {
            return err;
        }
    }
    return ESP_ERR_NOT_FOUND;
}

esp_err_t msgCounterNext(uint64_t *count) {
    esp_err_t err = nvs_get_u64(msgcounter_db_handle, MSGCOUNTER_KEY, count);
    ESP_ERROR_CHECK(err);

    err = nvs_set_u64(msgcounter_db_handle, MSGCOUNTER_KEY, *count+1);
    ESP_ERROR_CHECK(err);
    return err;
}
