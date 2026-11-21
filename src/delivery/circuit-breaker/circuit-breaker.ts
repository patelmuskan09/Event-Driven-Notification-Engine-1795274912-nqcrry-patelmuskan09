export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  failureThreshold: number; // e.g. 5 failures
  windowMs: number; // e.g. 60,000 ms (60s)
  openPeriodMs: number; // e.g. 60,000 ms (60s cooldown)
  name: string;
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureTimestamps: number[] = [];
  private stateChangedAt: number = Date.now();
  private halfOpenSuccesses: number = 0;
  private readonly config: CircuitBreakerConfig;

  constructor(config: CircuitBreakerConfig) {
    this.config = config;
  }

  public getState(): CircuitState {
    const now = Date.now();
    if (this.state === 'OPEN') {
      if (now - this.stateChangedAt >= this.config.openPeriodMs) {
        this.transitionTo('HALF_OPEN');
      }
    }
    return this.state;
  }

  public canExecute(): boolean {
    const currentState = this.getState();
    return currentState === 'CLOSED' || currentState === 'HALF_OPEN';
  }

  public recordSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= 2) {
        this.transitionTo('CLOSED');
      }
    } else if (this.state === 'CLOSED') {
      // Clean old failures
      this.failureTimestamps = [];
    }
  }

  public recordFailure(): void {
    const now = Date.now();
    this.failureTimestamps.push(now);

    // Prune failures outside the rolling window
    const windowStart = now - this.config.windowMs;
    this.failureTimestamps = this.failureTimestamps.filter((t) => t >= windowStart);

    if (this.state === 'HALF_OPEN') {
      // Immediate trip back to OPEN if it failed during probe
      this.transitionTo('OPEN');
    } else if (this.state === 'CLOSED' && this.failureTimestamps.length >= this.config.failureThreshold) {
      this.transitionTo('OPEN');
    }
  }

  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;
    this.stateChangedAt = Date.now();
    this.halfOpenSuccesses = 0;
    if (newState === 'OPEN') {
      console.warn(
        `[CIRCUIT_BREAKER] ${this.config.name} tripped to OPEN state! Failures: ${this.failureTimestamps.length}`
      );
    } else if (newState === 'CLOSED') {
      console.info(`[CIRCUIT_BREAKER] ${this.config.name} recovered to CLOSED state.`);
    }
  }

  public forceState(state: CircuitState): void {
    this.state = state;
    this.stateChangedAt = Date.now();
  }

  public getStats() {
    return {
      name: this.config.name,
      state: this.getState(),
      recentFailures: this.failureTimestamps.length,
      threshold: this.config.failureThreshold,
      stateChangedAt: new Date(this.stateChangedAt).toISOString(),
    };
  }
}
