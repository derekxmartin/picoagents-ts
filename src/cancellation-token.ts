/**
 * Cancellation token implementation for graceful task cancellation.
 *
 * Provides a mechanism for cancelling pending async operations in a consistent manner.
 * Since JavaScript is single-threaded, no lock is needed (unlike the Python version).
 */

export class CancellationToken {
  private _cancelled = false;
  private _callbacks: Array<() => void> = [];

  /**
   * Cancel pending async calls linked to this cancellation token.
   */
  cancel(): void {
    if (!this._cancelled) {
      this._cancelled = true;
      for (const callback of this._callbacks) {
        try {
          callback();
        } catch {
          // Don't let callback errors affect cancellation
        }
      }
    }
  }

  /**
   * Check if the CancellationToken has been cancelled.
   */
  isCancelled(): boolean {
    return this._cancelled;
  }

  /**
   * Attach a callback that will be called when cancel is invoked.
   */
  addCallback(callback: () => void): void {
    if (this._cancelled) {
      try {
        callback();
      } catch {
        // Don't let callback errors affect cancellation
      }
    } else {
      this._callbacks.push(callback);
    }
  }

  /**
   * Link a Promise to this token using an AbortController.
   * When cancel() is called, the AbortController's signal will be aborted.
   *
   * Returns the AbortSignal so the caller can pass it to fetch(), etc.
   */
  linkAbortController(controller: AbortController): AbortController {
    if (this._cancelled) {
      controller.abort();
    } else {
      this._callbacks.push(() => controller.abort());
    }
    return controller;
  }

  /**
   * Create a promise that rejects when cancellation occurs.
   * Useful for Promise.race() patterns.
   */
  createCancellationPromise<T = never>(): Promise<T> {
    return new Promise<T>((_, reject) => {
      if (this._cancelled) {
        reject(new CancelledError("Operation was cancelled"));
      } else {
        this.addCallback(() => {
          reject(new CancelledError("Operation was cancelled"));
        });
      }
    });
  }
}

/**
 * Error thrown when an operation is cancelled via CancellationToken.
 */
export class CancelledError extends Error {
  constructor(message = "Operation was cancelled") {
    super(message);
    this.name = "CancelledError";
  }
}
