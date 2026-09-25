/*
 * SPDX-FileCopyrightText: 2010-2022 Espressif Systems (Shanghai) CO LTD
 *
 * SPDX-License-Identifier: CC0-1.0
 */

#include <stdio.h>
#include <inttypes.h>
#include "sdkconfig.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_chip_info.h"
#include "esp_flash.h"
#include "esp_system.h"
#include "driver/gpio.h"

#define KBD_R1_PIN GPIO_NUM_6
#define KBD_R2_PIN GPIO_NUM_7
#define KBD_R3_PIN GPIO_NUM_8
#define KBD_R4_PIN GPIO_NUM_9

#define KBD_C1_PIN GPIO_NUM_1
#define KBD_C2_PIN GPIO_NUM_0
#define KBD_C3_PIN GPIO_NUM_3
#define KBD_C4_PIN GPIO_NUM_2

const gpio_num_t ROW_PINS[] = {
    KBD_R1_PIN, KBD_R2_PIN, KBD_R3_PIN, KBD_R4_PIN
};
const gpio_num_t COL_PINS[] = {
    KBD_C1_PIN, KBD_C2_PIN, KBD_C3_PIN, KBD_C4_PIN
};

#define KBD_ROWS (sizeof(ROW_PINS) / sizeof(ROW_PINS[0]))
#define KBD_COLS (sizeof(COL_PINS) / sizeof(COL_PINS[0]))

void initialize_kbd_gpios(void)
{
    for (int r = 0; r < KBD_ROWS; r++) {
        gpio_set_direction(ROW_PINS[r], GPIO_MODE_INPUT);
        gpio_set_pull_mode(ROW_PINS[r], GPIO_PULLUP_ONLY);
    }
    for (int c = 0; c < KBD_COLS; c++) {
        gpio_set_direction(COL_PINS[c], GPIO_MODE_OUTPUT);
        gpio_set_level(COL_PINS[c], 1);   // idle high
    }
}

// Returns the 
int check_kbd() {
    for (int i = 0; i < KBD_COLS; i++) {
       gpio_set_level(COL_PINS[i], 0);
       for (int j = 0; j < KBD_ROWS; j++) {
           if (gpio_get_level(ROW_PINS[j]) != 0) {
               continue;
           }

           if (gpio_get_level(ROW_PINS[j]) == 0) {
               return i*KBD_COLS + j;
           }
       } 
       gpio_set_level(COL_PINS[i], 1); 
    }
    return -1;
}

void app_main(void)
{
    initialize_kbd_gpios();

    printf("Hello world - GPIOD!\n");

    /* Print chip information */
    esp_chip_info_t chip_info;
    uint32_t flash_size;
    esp_chip_info(&chip_info);
    printf("This is %s chip with %d CPU core(s), %s%s%s%s, ",
           CONFIG_IDF_TARGET,
           chip_info.cores,
           (chip_info.features & CHIP_FEATURE_WIFI_BGN) ? "WiFi/" : "",
           (chip_info.features & CHIP_FEATURE_BT) ? "BT" : "",
           (chip_info.features & CHIP_FEATURE_BLE) ? "BLE" : "",
           (chip_info.features & CHIP_FEATURE_IEEE802154) ? ", 802.15.4 (Zigbee/Thread)" : "");

    unsigned major_rev = chip_info.revision / 100;
    unsigned minor_rev = chip_info.revision % 100;
    printf("silicon revision v%d.%d, ", major_rev, minor_rev);
    if(esp_flash_get_size(NULL, &flash_size) != ESP_OK) {
        printf("Get flash size failed");
        return;
    }

    printf("%" PRIu32 "MB %s flash\n", flash_size / (uint32_t)(1024 * 1024),
           (chip_info.features & CHIP_FEATURE_EMB_FLASH) ? "embedded" : "external");

    printf("Minimum free heap size: %" PRIu32 " bytes\n", esp_get_minimum_free_heap_size());

    for (int i = 10; i >= 0; i--) {
        printf("Restarting in %d seconds...\n", i);
        vTaskDelay(1000 / portTICK_PERIOD_MS);
    }
    printf("Restarting now.\n");
    fflush(stdout);
    // esp_restart();
    //

}
