#include "gpio.h"
#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

SemaphoreHandle_t lock_mutex;

void initLock(void) {
    gpio_set_direction(GPIO_NUM_8, GPIO_MODE_OUTPUT);
    lock_mutex = xSemaphoreCreateMutex();
    xSemaphoreTake(lock_mutex);
    gpio_set_level(GPIO_NUM_8, 0);
}

void openDoor()
{
    xSemaphoreGive(lock_mutex);
}

void vlockTask(void *pvParameters) {
    for (;;) {
        xSemaphoreTake(lock_mutex);
        gpio_set_level(GPIO_NUM_8, 1);
        vTaskDelay(1000 / portTICK_PERIOD_MS);
        gpio_set_level(GPIO_NUM_8, 0);
    }
}
