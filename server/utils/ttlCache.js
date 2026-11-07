// Tiny in-memory cache with an expiry, for slow lookups repeated within one
// USSD session (USSD replays every earlier input on each step).
export function createTtlCache(ttlMs, maxEntries = 500) {
  const store = new Map();
  return {
    get(key) {
      const hit = store.get(key);
      if (!hit) return undefined;
      if (hit.expires <= Date.now()) {
        store.delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key, value) {
      if (store.size >= maxEntries) store.delete(store.keys().next().value);
      store.set(key, { value, expires: Date.now() + ttlMs });
    },
  };
}
