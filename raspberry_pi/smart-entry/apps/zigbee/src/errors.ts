export class LockUnreachableError extends Error {
  constructor() {
    super("lock is unreachable")
    this.name = "LockUnreachableError"
  }
}

export class LockTimeoutError extends Error {
  constructor() {
    super("lock did not respond in time")
    this.name = "LockTimeoutError"
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "NotFoundError"
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ConflictError"
  }
}

export class LockBusyError extends Error {
  constructor() {
    super("another lock operation is still pending")
    this.name = "LockBusyError"
  }
}

export class SyncRequiredError extends Error {
  constructor() {
    super("sync required after an uncertain write")
    this.name = "SyncRequiredError"
  }
}
