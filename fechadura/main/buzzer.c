#include "freertos/FreeRTOS.h"
#include "driver/gpio.h"
#include "freertos/task.h"
#include "driver/ledc_etm.h"

#include "buzzer.h"

void initialize_buzzer_gpio(void) {
    gpio_set_direction(BZR_PIN, GPIO_MODE_OUTPUT);
    gpio_set_level(BZR_PIN, 0);
}

void buzz(int frequency) {
    gpio_set_level(BZR_PIN, 1);
    vTaskDelay(1000 / portTICK_PERIOD_MS);
    gpio_set_level(BZR_PIN, 0);
}
