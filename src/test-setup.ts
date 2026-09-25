// Polyfill localStorage. Node 22+ exposes a native `localStorage` global that is
// inert (and reads as `undefined`) unless started with `--localstorage-file`, and
// the unit-test builder doesn't wire up jsdom's own storage. Services that read
// localStorage in a field initializer (e.g. BlogStateService) would throw on
// construction without this.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  const localStorageMock: Storage = {
    get length() {
      return store.size;
    },
    key: (index) => Array.from(store.keys())[index] ?? null,
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    setItem: (key, value) => void store.set(key, String(value)),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    configurable: true,
    writable: true,
  });
}

// Polyfill matchMedia for jsdom (used by LayoutService for responsive signals).
// Query state is kept per-query string so repeated `matchMedia(query)` calls
// (e.g. once in the service under test, once in a spec) share the same list
// and a manually dispatched change event reaches listeners registered by both.
if (typeof globalThis.matchMedia === 'undefined') {
  const mediaQueryLists = new Map<string, MediaQueryList>();

  globalThis.matchMedia = ((query: string) => {
    const existing = mediaQueryLists.get(query);
    if (existing) return existing;

    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const mutableList = {
      matches: false,
      media: query,
      onchange: null,
      addEventListener: (_type: 'change', listener: (event: MediaQueryListEvent) => void) =>
        void listeners.add(listener),
      removeEventListener: (_type: 'change', listener: (event: MediaQueryListEvent) => void) =>
        void listeners.delete(listener),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      addListener: () => {},
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      removeListener: () => {},
      dispatchEvent: () => false,
      dispatchChange: (matches: boolean) => {
        mutableList.matches = matches;
        listeners.forEach((listener) => listener({ matches } as MediaQueryListEvent));
      },
    };
    const mediaQueryList = mutableList as unknown as MediaQueryList;

    mediaQueryLists.set(query, mediaQueryList);
    return mediaQueryList;
  }) as unknown as typeof globalThis.matchMedia;
}

// Polyfill IntersectionObserver for jsdom (used by Angular's @defer on viewport)
if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = class IntersectionObserver {
    readonly root = null;
    readonly rootMargin = '0px';
    readonly thresholds = [0];
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    observe() {}
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    unobserve() {}
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  } as unknown as typeof globalThis.IntersectionObserver;
}
