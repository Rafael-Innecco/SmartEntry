#include "keyboard.h"
#include "gpio.h"
#include "freertos/FreeRTOS.h"
#include "freertos/idf_additions.h"
#include "freertos/task.h"
#include "portmacro.h"
#include <stdio.h>
#include <stdlib.h>

const gpio_num_t ROW_PINS[] = {KBD_R1_PIN, KBD_R2_PIN, KBD_R3_PIN, KBD_R4_PIN};
const gpio_num_t COL_PINS[] = {KBD_C1_PIN, KBD_C2_PIN, KBD_C3_PIN, KBD_C4_PIN};

const char KBD_ARR[] = {'1', '4', '7', '*', '2', '5', '8', '0',
                        '3', '6', '9', '#', 'A', 'B', 'C', 'D'};

#define KBD_ROWS (sizeof(ROW_PINS) / sizeof(ROW_PINS[0]))
#define KBD_COLS (sizeof(COL_PINS) / sizeof(COL_PINS[0]))

QueueHandle_t xKeyboardQueue;

void initialize_kbd_gpios(void) {
  for (int r = 0; r < KBD_ROWS; r++) {
    gpio_set_direction(ROW_PINS[r], GPIO_MODE_INPUT);
    gpio_set_pull_mode(ROW_PINS[r], GPIO_PULLUP_ONLY);
  }
  for (int c = 0; c < KBD_COLS; c++) {
    gpio_set_direction(COL_PINS[c], GPIO_MODE_OUTPUT);
    gpio_set_level(COL_PINS[c], 1); // idle high
  }
}

char check_kbd() {
  for (int i = 0; i < KBD_COLS; i++) {
    gpio_set_level(COL_PINS[i], 0);
    for (int j = 0; j < KBD_ROWS; j++) {
      if (gpio_get_level(ROW_PINS[j]) != 0) {
        continue;
      }

      if (gpio_get_level(ROW_PINS[j]) == 0) {
        while (gpio_get_level(ROW_PINS[j]) == 0) {
        }
        return KBD_ARR[i * KBD_COLS + j];
      }
    }
    gpio_set_level(COL_PINS[i], 1);
  }
  return '\0';
}

void writeToQueue(char value) {
  BaseType_t xStatus;

  xStatus = xQueueSendToBack(xKeyboardQueue, &value, 0);
}

void vKeyboardTask(void *pvParameters) {
  printf("\033[32mStarting keyboard task\033[0m\n");
  fflush(stdout);
  initialize_kbd_gpios();

  int ret = '\0';
  for (;;) {
    ret = check_kbd();
    if (ret != '\0') {
      writeToQueue(ret);
      fflush(stdout);
    }

    vTaskDelay(200 / portTICK_PERIOD_MS);
  }

  // Should never run, insurance against the task exiting
  vTaskDelete(NULL);
}
