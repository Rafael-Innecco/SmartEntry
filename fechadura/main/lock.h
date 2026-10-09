#ifndef LOCK_H

#define LOCK_H

void openDoor(void);
void vLockTask(void *pvParameters);
int initLock(void);

#endif
