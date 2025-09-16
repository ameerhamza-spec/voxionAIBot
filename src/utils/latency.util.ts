export class LatencyTracker {
  private startTime: number;
  private label: string;

  constructor(label: string) {
    this.label = label;
    this.startTime = Date.now();
  }

  end() {
    const duration = Date.now() - this.startTime;
    console.log(`[Latency] ${this.label}: ${duration} ms`);
    return duration;
  }

  static async track<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      const duration = Date.now() - start;
      console.log(`[Latency] ${label}: ${duration} ms`);
      return result;
    } catch (err) {
      const duration = Date.now() - start;
      console.error(`[Latency] ${label} FAILED after ${duration} ms`, err);
      throw err;
    }
  }
}
