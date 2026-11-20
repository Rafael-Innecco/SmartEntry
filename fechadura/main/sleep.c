#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_sleep.h"
#include "gpio.h"
#include "hal/gpio_types.h"

#include "sleep.h"

#define TAG "sleep"

void setup_deep_sleep_wakeup(void) {
    // setup WAKEUP_PIN as pull up
    const gpio_config_t config = {
        .pin_bit_mask = 1ULL << WAKEUP_PIN,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    ESP_ERROR_CHECK(gpio_config(&config));

    // setup ext wakeup on WAKEUP_PIN low (gpio.h)
    // The pin pad is held by the sleep driver during deep sleep, so the pull up
    // is kept
    ESP_LOGI(TAG, "Enabling EXT1 wakeup on GPIO%d", WAKEUP_PIN);
    ESP_ERROR_CHECK(esp_sleep_enable_ext1_wakeup_io(1ULL << WAKEUP_PIN,
                                                    ESP_EXT1_WAKEUP_ANY_LOW));
}

void go_to_sleep() {
    ESP_LOGI(TAG, "GOING TO SLEEP");
    esp_deep_sleep_start();
}
