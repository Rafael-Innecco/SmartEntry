idf_component_register(SRC_DIRS "."  "totp" "zigbee"
                       PRIV_REQUIRES spi_flash esp_driver_gpio esp_driver_ledc vfs nvs_flash
                       INCLUDE_DIRS "")
