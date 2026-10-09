idf_component_register(SRC_DIRS "."  "totp"
                       PRIV_REQUIRES spi_flash esp_driver_gpio esp_driver_ledc nvs_flash
                       INCLUDE_DIRS "")
