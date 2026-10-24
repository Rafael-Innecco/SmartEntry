#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "driver/mcpwm_prelude.h"

#include "gpio.h"

#define TAG "lock"

#define SERVO_TIMEBASE_RESOLUTION_HZ 1000000  // 1MHz, 1us per tick
#define SERVO_TIMEBASE_PERIOD        20000    // 20000 ticks, 20ms
#define SERVO_MIN_PULSEWIDTH_US 500           // Minimum pulse width in microsecond
#define SERVO_MAX_PULSEWIDTH_US 2400          // Maximum pulse width in microsecond
#define SERVO_MIN_DEGREE        -90           // Minimum angle
#define SERVO_MAX_DEGREE        90            // Maximum angle

#define OPEN_ANGLE 0
#define CLOSED_ANGLE 90

SemaphoreHandle_t lock_semaph;
mcpwm_cmpr_handle_t pwm_comparator;

static inline uint32_t angle_to_pulsewidth(int angle)
{
    return (angle - SERVO_MIN_DEGREE) 
        * (SERVO_MAX_PULSEWIDTH_US - SERVO_MIN_PULSEWIDTH_US) 
        / (SERVO_MAX_DEGREE - SERVO_MIN_DEGREE) 
        + SERVO_MIN_PULSEWIDTH_US;
}

static void initMCPWM(void) {
    // MCPPWM setup
    mcpwm_timer_handle_t timer = NULL;
    mcpwm_timer_config_t timer_config = {
        .group_id = 0,
        .clk_src = MCPWM_TIMER_CLK_SRC_DEFAULT,
        .resolution_hz = SERVO_TIMEBASE_RESOLUTION_HZ,
        .period_ticks = SERVO_TIMEBASE_PERIOD,
        .count_mode = MCPWM_TIMER_COUNT_MODE_UP,
    };
    ESP_ERROR_CHECK(mcpwm_new_timer(&timer_config, &timer));

    mcpwm_oper_handle_t oper = NULL;
    mcpwm_operator_config_t operator_config = {
        .group_id = 0, // operator must be in the same group to the timer
    };
    ESP_ERROR_CHECK(mcpwm_new_operator(&operator_config, &oper));

    ESP_LOGI(TAG, "Connect timer and operator");
    ESP_ERROR_CHECK(mcpwm_operator_connect_timer(oper, timer));

    ESP_LOGI(TAG, "Create comparator and generator from the operator");
    pwm_comparator = NULL;
    mcpwm_comparator_config_t comparator_config = {
        .flags.update_cmp_on_tez = true,
    };
    ESP_ERROR_CHECK(mcpwm_new_comparator(oper, &comparator_config, &pwm_comparator));

    mcpwm_gen_handle_t generator = NULL;
    mcpwm_generator_config_t generator_config = {
        .gen_gpio_num = LOCK_CONTROL_PIN,
    };
    ESP_ERROR_CHECK(mcpwm_new_generator(oper, &generator_config, &generator));

    // set the initial compare value, so that the servo will spin to the center position
    ESP_ERROR_CHECK(mcpwm_comparator_set_compare_value(pwm_comparator, angle_to_pulsewidth(CLOSED_ANGLE)));

    ESP_LOGI(TAG, "Set generator action on timer and compare event");
    // go high on counter empty
    ESP_ERROR_CHECK(mcpwm_generator_set_action_on_timer_event(generator,
                                                              MCPWM_GEN_TIMER_EVENT_ACTION(MCPWM_TIMER_DIRECTION_UP, MCPWM_TIMER_EVENT_EMPTY, MCPWM_GEN_ACTION_HIGH)));
    // go low on compare threshold
    ESP_ERROR_CHECK(mcpwm_generator_set_action_on_compare_event(generator,
                                                                MCPWM_GEN_COMPARE_EVENT_ACTION(MCPWM_TIMER_DIRECTION_UP, pwm_comparator, MCPWM_GEN_ACTION_LOW)));

    ESP_LOGI(TAG, "Enable and start timer");
    ESP_ERROR_CHECK(mcpwm_timer_enable(timer));
    ESP_ERROR_CHECK(mcpwm_timer_start_stop(timer, MCPWM_TIMER_START_NO_STOP));
}

static void set_servo_angle(int angle)
{
    ESP_ERROR_CHECK(mcpwm_comparator_set_compare_value(pwm_comparator, angle_to_pulsewidth(angle)));
}

int initLock(void) {
    initMCPWM();

    // allocate lock semaphore
    lock_semaph = xSemaphoreCreateMutex();

    if (lock_semaph == NULL) {
        return 1;
    }

    return 0;
}

void openDoor() { 
    xSemaphoreTake(lock_semaph, portMAX_DELAY);
    set_servo_angle(OPEN_ANGLE);
    if (xSemaphoreGive(lock_semaph) != pdTRUE) {
        ESP_LOGE(TAG, "failed to release lock semaph (open)");
    }
    ESP_LOGI(TAG, "opened");
}

void closeDoor() {
    xSemaphoreTake(lock_semaph, portMAX_DELAY);
    set_servo_angle(CLOSED_ANGLE);
    if (xSemaphoreGive(lock_semaph) != pdTRUE) {
        ESP_LOGE(TAG, "failed to release lock semaph (close)");
    }
    ESP_LOGI(TAG, "closed");
}
