export interface InferenceJob<Result> {
  readonly id: string;
  readonly candidateRevision: number;
  readonly run: (signal: AbortSignal) => Promise<Result>;
}

interface QueuedJob<Result> extends InferenceJob<Result> {
  readonly resolve: (value: Result) => void;
  readonly reject: (reason: unknown) => void;
}

export class InferenceScheduler<Result> {
  private readonly queue: QueuedJob<Result>[] = [];
  private active: { id: string; controller: AbortController } | undefined;
  private paused = false;

  constructor(readonly maximumQueueLength = 2) {
    if (maximumQueueLength < 1)
      throw new RangeError("Inference queue length must be positive");
  }

  get queueLength() {
    return this.queue.length + (this.active ? 1 : 0);
  }

  enqueue(job: InferenceJob<Result>) {
    this.cancel(job.id);
    if (this.queue.length >= this.maximumQueueLength) {
      const obsolete = this.queue.shift();
      obsolete?.reject(
        new DOMException("Inference job superseded", "AbortError"),
      );
    }
    const promise = new Promise<Result>((resolve, reject) => {
      this.queue.push({ ...job, resolve, reject });
    });
    void this.drain();
    return promise;
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    if (!paused) void this.drain();
  }

  cancel(id: string) {
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      if (this.queue[index].id === id) {
        const [job] = this.queue.splice(index, 1);
        job.reject(new DOMException("Inference job cancelled", "AbortError"));
      }
    }
    if (this.active?.id === id) this.active.controller.abort();
  }

  dispose() {
    this.active?.controller.abort();
    for (const job of this.queue.splice(0)) {
      job.reject(
        new DOMException("Inference scheduler disposed", "AbortError"),
      );
    }
  }

  private async drain() {
    if (this.paused || this.active || this.queue.length === 0) return;
    const job = this.queue.shift()!;
    const controller = new AbortController();
    this.active = { id: job.id, controller };
    try {
      const result = await job.run(controller.signal);
      if (!controller.signal.aborted) job.resolve(result);
      else job.reject(new DOMException("Inference job aborted", "AbortError"));
    } catch (error) {
      job.reject(error);
    } finally {
      this.active = undefined;
      void this.drain();
    }
  }
}
