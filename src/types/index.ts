/**
 * Minimal AbortSignal shape (DOM / Node compatible).
 * Avoids depending on the DOM lib in published types.
 */
export interface AbortSignalLike {
  readonly aborted: boolean;
  addEventListener(
    type: "abort",
    listener: () => void,
    options?: { once?: boolean },
  ): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

export type LimitOptions = {
  signal?: AbortSignalLike;
};

export type AsyncQueue = {
  <T>(fn: () => Promise<T>, options?: LimitOptions): Promise<T>;
  readonly active: number;
  readonly pending: number;
  concurrency: number;
  clear(rejectPending?: boolean): void;
  onIdle(): Promise<void>;
};
