#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
#include "hmac.h"

#define KEYLEN 32

uint8_t key[32] = { 
    123, 42, 69, 67, 
    123, 42, 69, 67, 
    123, 42, 69, 67, 
    123, 42, 69, 67, 
    123, 42, 69, 67, 
    123, 42, 69, 67, 
    123, 42, 69, 67, 
    123, 42, 69, 67, 
};

typedef struct totp {
    void* key;       // secret key
    size_t keylen;   // key size
    uint64_t t0;     // start epoch
    uint8_t tx;      // one-time duration
    uint8_t codelen; // code size (e.g. 6 or 8)
} totp;

///////////////////////////////////////////////////////////////////////////////
/// TOTP and HOTP implementation
/// https://en.wikipedia.org/wiki/HMAC-based_one-time_password#Algorithm
/// https://en.wikipedia.org/wiki/Time-based_one-time_password#Algorithm
///////////////////////////////////////////////////////////////////////////////
uint32_t truncate_mac(const void* mac, const size_t maclen) {
    const uint8_t* macbytes = (uint8_t*) mac;
    uint8_t index = macbytes[maclen-1] & 0xF;
    return ((uint32_t) (macbytes[index] & 0x7F) << 24)
         | ((uint32_t) macbytes[index+1] << 16)
         | ((uint32_t) macbytes[index+2] << 8)
         | ((uint32_t) macbytes[index+3]);
}

void compute_hotp(const void* key, const size_t keylen, uint64_t counter, uint8_t codelen, uint8_t* output) {
    // counter as 8-byte big-endian message
    uint8_t msg[8];
    for (int i = 7; i >= 0; i--) {
        msg[i] = counter & 0xFF;
        counter >>= 8;
    }

    uint8_t mac[20];
    hmac_sha1(key, keylen, msg, sizeof(msg), mac);

    uint32_t code = truncate_mac(mac, sizeof(mac));

    for (int i = codelen - 1; i >= 0; i--) {
        output[i] = code % 10;
        code /= 10;
    }
}

void compute_totp(const totp* config, uint64_t current_time, uint8_t* output) {
    uint64_t counter = (current_time - config->t0) / config->tx;
    compute_hotp(config->key, config->keylen, counter, config->codelen, output);
}

///////////////////////////////////////////////////////////////////////////////
/// URI generation
///////////////////////////////////////////////////////////////////////////////
void print_digits(const uint8_t* digits, const size_t len) {
    for (size_t i = 0; i < len; i++) {
        printf("%u", digits[i]);
    }
}

size_t base32_encode(const uint8_t* data, const size_t len, char* out, const size_t outlen) {
    static const char alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    size_t needed = (len * 8 + 4) / 5;
    if (outlen < needed + 1) {
        return 0;
    }

    size_t pos = 0;
    uint32_t buffer = 0;
    int bits = 0;
    for (size_t i = 0; i < len; i++) {
        buffer = (buffer << 8) | data[i];
        bits += 8;
        while (bits >= 5) {
            out[pos++] = alphabet[(buffer >> (bits - 5)) & 0x1F];
            bits -= 5;
        }
    }
    if (bits > 0) {
        out[pos++] = alphabet[(buffer << (5 - bits)) & 0x1F];
    }
    out[pos] = '\0';
    return pos;
}

size_t build_otpauth_url(const totp* config, const char* issuer, const char* account, char* out, const size_t outlen) {
    char secret[128];
    if (base32_encode(config->key, config->keylen, secret, sizeof(secret)) == 0) {
        return 0;
    }

    int n = snprintf(out, outlen,
        "otpauth://totp/%s:%s?secret=%s&issuer=%s&digits=%u&period=%u",
        issuer, account, secret, issuer, config->codelen, config->tx);
    if (n < 0 || (size_t) n >= outlen) {
        return 0;
    }
    return n;
}

int main(int argc, char** argv) {
    const totp mytotp = {
        .key = key,
        .keylen = KEYLEN,
        .t0 = 0,
        .tx = 30,
        .codelen = 6,
    };

    char url[256];
    if (build_otpauth_url(&mytotp, "SmartEntry", "lock", url, sizeof(url))) {
        printf("%s\n", url);
    }

    // compute totp, wait for tx, print next code, repeat
    uint8_t code[8];
    while (1) {
        uint64_t now = time(NULL);
        compute_totp(&mytotp, now, code);
        printf("step %llu: ", (unsigned long long) ((now - mytotp.t0) / mytotp.tx));
        print_digits(code, mytotp.codelen);
        printf("\n");
        fflush(stdout);
        sleep(mytotp.tx - (now - mytotp.t0) % mytotp.tx);
    }

    return 0;
}
