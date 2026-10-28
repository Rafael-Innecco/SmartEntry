#ifndef DB_H
#define DB_H

#define MAX_USERNAME_LEN 64

#include <stdint.h>
#include "esp_err.h"
#include "totp/totp.h"

typedef struct {
    uint8_t id;
    char name[MAX_USERNAME_LEN];
    uint8_t key[TOTP_KEYLEN];
} DbUser;

typedef struct {
    uint8_t id;
    uint16_t next_id;
} UserIterator;

esp_err_t initDb(void);

esp_err_t storeUser(uint8_t id, DbUser *record);
esp_err_t eraseUser(uint8_t id);
esp_err_t loadUser(uint8_t id, DbUser *record);

esp_err_t initUserIter(UserIterator* iter);
esp_err_t nextUser(UserIterator* iter);

esp_err_t msgCounterNext(uint64_t *count);

#endif
