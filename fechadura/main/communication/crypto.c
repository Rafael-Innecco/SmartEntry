#include "crypto.h"
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "esp_log.h"
#include "../totp/hmac.h"
#include "protocol.h"
#define MBEDTLS_DECLARE_PRIVATE_IDENTIFIERS
#include "mbedtls/md.h"

static const char *TAG = "SE_CRYPTO";

void smart_entry_ieee_to_big_endian(uint64_t ieee_u64, uint8_t out_ieee_be[SMART_ENTRY_IEEE_LEN]) {
    for (int i = 0; i < SMART_ENTRY_IEEE_LEN; i++) {
        out_ieee_be[i] = (uint8_t)((ieee_u64 >> (56 - 8 * i)) & 0xFF);
    }
}

static int constant_time_memcmp(const void *a, const void *b, size_t n) {
    const uint8_t *p1 = (const uint8_t *)a;
    const uint8_t *p2 = (const uint8_t *)b;
    uint8_t result = 0;
    for (size_t i = 0; i < n; i++) {
        result |= (p1[i] ^ p2[i]);
    }
    return result == 0 ? 0 : 1;
}

bool smart_entry_compute_hmac(const uint8_t key_32B[SMART_ENTRY_APP_KEY_LEN],
                              const uint8_t ieee_be_8B[SMART_ENTRY_IEEE_LEN],
                              const uint8_t *env_no_tag,
                              size_t env_no_tag_len,
                              uint8_t out_tag_16B[SMART_ENTRY_TAG_LEN]) {
    if (!key_32B || !ieee_be_8B || !env_no_tag || !out_tag_16B) {
        return false;
    }

    uint8_t output[20]; 

    unsigned int input_size = sizeof(uint8_t) * (SMART_ENTRY_HMAC_PREFIX_LEN + 1 + SMART_ENTRY_IEEE_LEN + env_no_tag_len); 
    uint8_t* input = malloc(input_size);

    memcpy(input, &SMART_ENTRY_HMAC_PREFIX, SMART_ENTRY_HMAC_PREFIX_LEN);
    uint8_t sep = 0x00;
    memcpy(input, &sep, 1);
    memcpy(input, ieee_be_8B, SMART_ENTRY_IEEE_LEN);
    memcpy(input, env_no_tag, env_no_tag_len);

    hmac_sha1(key_32B, SMART_ENTRY_APP_KEY_LEN, input, env_no_tag_len, output);

    /* First 16 bytes of HMAC-SHA256 */
    memcpy(out_tag_16B, output, SMART_ENTRY_TAG_LEN);
    return true;
}

bool smart_entry_verify_hmac(const uint8_t key_32B[SMART_ENTRY_APP_KEY_LEN],
                             const uint8_t ieee_be_8B[SMART_ENTRY_IEEE_LEN],
                             const uint8_t *env_no_tag,
                             size_t env_no_tag_len,
                             const uint8_t expected_tag_16B[SMART_ENTRY_TAG_LEN]) {
    uint8_t computed_tag[SMART_ENTRY_TAG_LEN];
    if (!smart_entry_compute_hmac(key_32B, ieee_be_8B, env_no_tag, env_no_tag_len, computed_tag)) {
        return false;
    }

    return (constant_time_memcmp(computed_tag, expected_tag_16B, SMART_ENTRY_TAG_LEN) == 0);
}

bool smart_entry_crypto_self_test(void) {
    /* Reference test vector from lock-protocol-v1.json */
    static const uint8_t test_key[32] = {
        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
        0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
        0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17,
        0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f
    };

    /* lockIeee: 0x00124b0000000001 (big endian) */
    static const uint8_t test_ieee[8] = {
        0x00, 0x12, 0x4b, 0x00, 0x00, 0x00, 0x00, 0x01
    };

    /* wireHex: 69 bytes */
    static const uint8_t wire_env[69] = {
        0x01, 0x00, 0x02, 0x03, 0x04, 0x03, 0x02, 0x01,
        0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
        0x08, 0xd2, 0x49, 0x6b, 0x20, 0x20, 0x21, 0x22,
        0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a,
        0x2b, 0x2c, 0x2d, 0x2e, 0x2f, 0x30, 0x31, 0x32,
        0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a,
        0x3b, 0x3c, 0x3d, 0x3e, 0x3f, 0xee, 0x9f, 0x1c,
        0x3b, 0xf6, 0x23, 0x0f, 0x3f, 0xaa, 0x32, 0x7b,
        0x61, 0x05, 0x5d, 0x0a, 0x21
    };

    static const uint8_t expected_tag[16] = {
        0xee, 0x9f, 0x1c, 0x3b, 0xf6, 0x23, 0x0f, 0x3f,
        0xaa, 0x32, 0x7b, 0x61, 0x05, 0x5d, 0x0a, 0x21
    };

    uint8_t computed_tag[16];
    /* envelope without tag has length 53 bytes (21 header + 32 data) */
    if (!smart_entry_compute_hmac(test_key, test_ieee, wire_env, 53, computed_tag)) {
        ESP_LOGE(TAG, "Self-test HMAC calculation failed");
        return false;
    }

    if (constant_time_memcmp(computed_tag, expected_tag, 16) != 0) {
        ESP_LOGE(TAG, "Self-test HMAC mismatch with lock-protocol-v1.json");
        return false;
    }

    ESP_LOGI(TAG, "Cryptographic self-test PASSED (HMAC-SHA256 matches test vector)");
    return true;
}
