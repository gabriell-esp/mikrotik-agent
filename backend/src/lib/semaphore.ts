/** Semáforo simples (FIFO) para limitar conexões simultâneas. */
export class Semaphore {
  private active = 0;
  private waiters: (() => void)[] = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<() => void> {
    if (this.active >= this.max) await new Promise<void>((r) => this.waiters.push(r));
    else this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) next(); // repassa a vaga sem decrementar
      else this.active--;
    };
  }

  get pending(): number {
    return this.waiters.length;
  }
}
