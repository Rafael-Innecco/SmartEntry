#ifndef KEYBOARD_H

#define KEYBOARD_H

#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

int readKeyboardQueue(char* c);
char check_kbd();
void vKeyboardTask(void *pvParameters);
int initializeKbdGpio(void);

#endif
