#ifndef SMART_ENTRY_CRYPTO_H
#define SMART_ENTRY_CRYPTO_H

#include "protocol.h"
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Convert a 64-bit IEEE address uint64 into 8 bytes in big-endian
 * network order.
 *
 * @param ieee_u64 64-bit IEEE address.
 * @param out_ieee_be 8-byte destination array.
 */
void smart_entry_ieee_to_big_endian(uint64_t ieee_u64,
                                    uint8_t out_ieee_be[SMART_ENTRY_IEEE_LEN]);

/**
 * @brief Compute the 16-byte HMAC-SHA1 tag (first 16 bytes) for a given
 * envelope.
 *
 * Signing payload:
 * ASCII("SmartEntry/v1") || 0x00 || IEEE_fechadura_8_bytes_BE ||
 * envelope_without_tag
 *
 * @param key_32B 32-byte application secret key.
 * @param ieee_be_8B 8-byte device IEEE address (big-endian).
 * @param env_no_tag Pointer to raw envelope bytes without the HMAC tag.
 * @param env_no_tag_len Length of envelope without tag (21 + N bytes).
 * @param out_tag_16B Output buffer for the 16-byte HMAC tag.
 * @return true on success, false on error.
 */
bool smart_entry_compute_hmac(const uint8_t key_32B[SMART_ENTRY_APP_KEY_LEN],
                              const uint8_t ieee_be_8B[SMART_ENTRY_IEEE_LEN],
                              const uint8_t *env_no_tag, size_t env_no_tag_len,
                              uint8_t out_tag_16B[SMART_ENTRY_TAG_LEN]);

/**
 * @brief Constant-time verification of HMAC tag.
 *
 * @param key_32B 32-byte application secret key.
 * @param ieee_be_8B 8-byte device IEEE address (big-endian).
 * @param env_no_tag Pointer to raw envelope bytes without the HMAC tag.
 * @param env_no_tag_len Length of envelope without tag (21 + N bytes).
 * @param expected_tag_16B 16-byte tag received from network.
 * @return true if HMAC matches byte-for-byte, false otherwise.
 */
bool smart_entry_verify_hmac(
    const uint8_t key_32B[SMART_ENTRY_APP_KEY_LEN],
    const uint8_t ieee_be_8B[SMART_ENTRY_IEEE_LEN], const uint8_t *env_no_tag,
    size_t env_no_tag_len, const uint8_t expected_tag_16B[SMART_ENTRY_TAG_LEN]);

/**
 * @brief Validate cryptographic calculations against reference test vectors
 * (lock-protocol-v1.json).
 *
 * @return true if self-test passes, false otherwise.
 */
bool smart_entry_crypto_self_test(void);

#ifdef __cplusplus
}
#endif

#endif /* SMART_ENTRY_CRYPTO_H */
