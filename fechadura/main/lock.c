#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "gpio.h"

SemaphoreHandle_t lock_semaph;

int initLock(void) {
    gpio_set_direction(LOCK_CONTROL_PIN, GPIO_MODE_OUTPUT);
    lock_semaph = xSemaphoreCreateBinary();

    if (lock_semaph == NULL) {
        return 1;
    }

    gpio_set_level(LOCK_CONTROL_PIN, 0);

    return 0;
}

void openDoor() { 
    if (xSemaphoreGive(lock_semaph) != pdTRUE) {
        printf("FAILED TO OPEN DOOR\n");
    }
}

void vLockTask(void *pvParameters) {
    for (;;) {
        xSemaphoreTake(lock_semaph, portMAX_DELAY);
        gpio_set_level(LOCK_CONTROL_PIN, 1);
        vTaskDelay(1000 / portTICK_PERIOD_MS);
        gpio_set_level(LOCK_CONTROL_PIN, 0);
    }
}
