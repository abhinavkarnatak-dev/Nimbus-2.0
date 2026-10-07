// Browser-session only: never persist repository contents to localStorage.
export class WorkspaceBrowserCache {
  readonly folders = new Map<string, boolean>();
  private entries = new Map<
    string,
    { value?: unknown; pending?: Promise<unknown>; bytes: number }
  >();
  private bytes = 0;
  constructor(
    private readonly limit = 128,
    private readonly byteLimit = 4_000_000,
  ) {}
  peek<T>(key: string): T | undefined {
    return this.entries.get(key)?.value as T | undefined;
  }
  load<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const existing = this.entries.get(key);
    if (existing) {
      this.entries.delete(key);
      this.entries.set(key, existing);
      if (existing.pending) return existing.pending as Promise<T>;
      return Promise.resolve(existing.value as T);
    }
    const entry: {
      value?: unknown;
      pending?: Promise<unknown>;
      bytes: number;
    } = { bytes: 0 };
    this.entries.set(key, entry);
    const pending = Promise.resolve()
      .then(loader)
      .then(
        (value) => {
          // A pre-refresh request must not populate the new cache generation.
          if (this.entries.get(key) === entry) {
            entry.value = value;
            delete entry.pending;
            entry.bytes = JSON.stringify(value).length * 2;
            this.bytes += entry.bytes;
            for (const [oldKey, old] of this.entries) {
              if (
                this.entries.size <= this.limit &&
                this.bytes <= this.byteLimit
              )
                break;
              if (old.pending) continue;
              this.entries.delete(oldKey);
              this.bytes -= old.bytes;
            }
          }
          return value;
        },
        (error) => {
          if (this.entries.get(key) === entry) this.entries.delete(key);
          throw error;
        },
      );
    entry.pending = pending;
    return pending;
  }
  clear() {
    this.entries.clear();
    this.bytes = 0;
  }
  seed(key: string, value: unknown) {
    return this.load(key, () => Promise.resolve(value));
  }
}
const sessions = new Map<
  string,
  { version: string; cache: WorkspaceBrowserCache }
>();
export function workspaceBrowserCache(scope: string, version: string) {
  // Client components are also rendered on the server; don't share user data there.
  if (typeof window === "undefined") return new WorkspaceBrowserCache();
  let session = sessions.get(scope);
  if (!session) session = { version, cache: new WorkspaceBrowserCache() };
  if (session.version !== version) {
    session.cache.clear();
    session.version = version;
  }
  sessions.delete(scope);
  sessions.set(scope, session);
  while (sessions.size > 4) sessions.delete(sessions.keys().next().value!);
  return session.cache;
}
