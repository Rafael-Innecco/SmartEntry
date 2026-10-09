#ifndef TOTP_H
#define TOTP_H

#include <stdint.h>
#include <string.h>

#define TOTP_T0 ((uint64_t) 0)
#define TOTP_TX ((uint8_t) 30)
#define TOTP_KEYLEN 32
#define TOTP_CODELEN 6

void compute_totp(const void *key, uint64_t current_time, uint8_t *output);

#endif
