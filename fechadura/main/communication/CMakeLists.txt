idf_component_register(SRC_DIRS "." "../totp"
                       INCLUDE_DIRS "."
                       PRIV_REQUIRES vfs nvs_flash mbedtls esp_timer)
