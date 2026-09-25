idf_component_register(SRCS "smart_entry_main.c" "keyboard.h" "keyboard.c"
                       PRIV_REQUIRES spi_flash esp_driver_gpio
                       INCLUDE_DIRS "")
