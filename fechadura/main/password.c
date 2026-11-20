#include <stdint.h>
#include <string.h>
#include <time.h>

#include "esp_log.h"
#include "ezbee/zcl/cluster/metering_desc.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "db.h"
#include "password.h"
#include "totp/totp.h"

#define TAG "totp"

int checkCode(uint8_t *c) {
    uint64_t now = time(NULL);
    uint8_t code[TOTP_CODELEN];

    UserIterator iter;
    initUserIter(&iter);

    DbUser user;

    while (nextUser(&iter) == ESP_OK) {
        for (int attempt = 0; attempt < 3; attempt++) {
            uint64_t ref = now - 30 + attempt*30;

            ESP_ERROR_CHECK(loadUser(iter.id, &user));
            compute_totp(user.key, ref, code);

            bool matches = true;
            for (int i = 0; i < TOTP_CODELEN; i++) {
                if (c[i] != code[i]) {
                    matches = false;
                }
            }

            if (matches)
                return 1;
        }
    }

    return 0;
}

// dummy task to print the TOTP code
void vDebugCodeTask(void *) {
    uint8_t code[TOTP_CODELEN];
    DbUser user;
    char code_str[TOTP_CODELEN + 1];
    code_str[TOTP_CODELEN] = '\0';

    for (;;) {
        uint64_t now = time(NULL);

        UserIterator iter;
        initUserIter(&iter);

        ESP_LOGW(TAG, "Current time: %llu", now);

        while (nextUser(&iter) == ESP_OK) {
            ESP_ERROR_CHECK(loadUser(iter.id, &user));
            compute_totp(user.key, now, code);

            for (int i = 0; i < TOTP_CODELEN; i++) {
                code_str[i] = code[i] + '0';
            }

            ESP_LOGI(TAG, "%s's current code: %s", user.name, code_str);
        }

        vTaskDelay(1000 / portTICK_PERIOD_MS);
    }
}
