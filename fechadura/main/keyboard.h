#ifndef KEYBOARD_H

#define KEYBOARD_H

#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

void initialize_kbd_gpios(void);
char check_kbd();

void vKeyboardTask(void *pvParameters);

extern QueueHandle_t xKeyboardQueue;

#endif
