#include <time.h>
#include <string.h>
#include <stdint.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "password.h"
#include "totp/totp.h"

uint8_t key[32] = {
    123, 42, 69, 67, 123, 42, 69, 67, 123, 42, 69, 67, 123, 42, 69, 67,
    123, 42, 69, 67, 123, 42, 69, 67, 123, 42, 69, 67, 123, 42, 69, 67,
};

int checkCode(uint8_t* c) {
    uint64_t now = time(NULL);
    uint8_t code[TOTP_CODELEN];
    compute_totp(key, now, code);

    for (int i = 0; i < TOTP_CODELEN; i++) {
        if (c[i] != code[i])
            return 0;
    }

    return 1;
}
