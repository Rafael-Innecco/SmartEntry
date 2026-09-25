
#include "driver/gpio.h"

#define KBD_R1_PIN GPIO_NUM_11
#define KBD_R2_PIN GPIO_NUM_12
#define KBD_R3_PIN GPIO_NUM_13
#define KBD_R4_PIN GPIO_NUM_14

#define KBD_C1_PIN GPIO_NUM_3
#define KBD_C2_PIN GPIO_NUM_2
#define KBD_C3_PIN GPIO_NUM_1
#define KBD_C4_PIN GPIO_NUM_0

void initialize_kbd_gpios(void);
int check_kbd();

void vKeyboardTask(void * pvParameters);
