export class WorkerConcurrencyLimitError extends Error {
  public constructor(message = "Maximum concurrent agent task limit reached.") {
    super(message);
    this.name = "WorkerConcurrencyLimitError";
  }
}

/**
 * In-process concurrency guard. This is a policy primitive, not an OS/container
 * isolation boundary. A future execution worker must enforce limits externally too.
 */
export class WorkerConcurrencyGuard {
  private activeTasks = 0;

  public constructor(private readonly maxConcurrentTasks = 1) {
    if (
      !Number.isSafeInteger(maxConcurrentTasks) ||
      maxConcurrentTasks < 1
    ) {
      throw new RangeError("maxConcurrentTasks must be a positive safe integer.");
    }
  }

  public get activeCount(): number {
    return this.activeTasks;
  }

  public acquire(): () => void {
    if (this.activeTasks >= this.maxConcurrentTasks) {
      throw new WorkerConcurrencyLimitError();
    }

    this.activeTasks += 1;
    let released = false;

    return (): void => {
      if (released) return;
      released = true;
      this.activeTasks -= 1;
    };
  }
}
