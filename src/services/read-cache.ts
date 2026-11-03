interface Entry { value: unknown; expiresAt: number; tag?: string }
interface Pending { promise: Promise<unknown>; tag?: string }

/** Bounded TTL cache with request coalescing and mutation-safe invalidation. */
export class ReadCache {
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Map<string, Pending>();
  private generation = 0;

  constructor(private readonly maximum = 2000, private readonly clock = () => Date.now()) {}

  async get<T>(key: string, ttl: number, load: () => Promise<T>, tag?: string, accept: (value: T) => boolean = () => true): Promise<T> {
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > this.clock()) return structuredClone(cached.value) as T;
    this.entries.delete(key);
    const inflight = this.pending.get(key);
    if (inflight) return structuredClone(await inflight.promise) as T;
    const generation = this.generation;
    const promise = Promise.resolve().then(load).then(value => {
      if (generation === this.generation && accept(value)) {
        if (this.entries.size >= this.maximum) this.entries.delete(this.entries.keys().next().value!);
        this.entries.set(key, { value: structuredClone(value), expiresAt: this.clock() + ttl, tag });
      }
      return value;
    });
    this.pending.set(key, { promise, tag });
    try { return structuredClone(await promise); }
    finally { if (this.pending.get(key)?.promise === promise) this.pending.delete(key); }
  }

  invalidate(tag: string): void {
    this.generation++;
    for (const [key, entry] of this.entries) if (entry.tag === tag) this.entries.delete(key);
    for (const [key, entry] of this.pending) if (entry.tag === tag) this.pending.delete(key);
  }
}
