import '@testing-library/jest-dom/vitest';

// jsdom 29 + Node 26 delegates localStorage to Node's experimental localStorage,
// which is only enabled with `--localstorage-file`. Provide an in-memory polyfill
// so tests can use localStorage without CLI flags.
if (typeof window !== 'undefined' && !window.localStorage) {
  class MemoryStorage implements Storage {
    private store = new Map<string, string>();
    get length(): number {
      return this.store.size;
    }
    clear(): void {
      this.store.clear();
    }
    getItem(key: string): string | null {
      return this.store.has(key) ? (this.store.get(key) as string) : null;
    }
    key(index: number): string | null {
      return Array.from(this.store.keys())[index] ?? null;
    }
    removeItem(key: string): void {
      this.store.delete(key);
    }
    setItem(key: string, value: string): void {
      this.store.set(key, String(value));
    }
  }
  Object.defineProperty(window, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
    writable: false,
  });
  Object.defineProperty(window, 'sessionStorage', {
    value: new MemoryStorage(),
    configurable: true,
    writable: false,
  });
  // mirror onto globalThis so bare `localStorage` works too
  Object.defineProperty(globalThis, 'localStorage', {
    value: window.localStorage,
    configurable: true,
    writable: false,
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: window.sessionStorage,
    configurable: true,
    writable: false,
  });
}
