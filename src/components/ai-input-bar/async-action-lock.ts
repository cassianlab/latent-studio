export interface AsyncActionLock {
  run(action: () => Promise<void>): Promise<boolean>
}

export function createAsyncActionLock(): AsyncActionLock {
  let running = false
  return {
    async run(action) {
      if (running) return false
      running = true
      try {
        await action()
        return true
      } finally {
        running = false
      }
    },
  }
}
