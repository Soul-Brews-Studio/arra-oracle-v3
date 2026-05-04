// Stub for Wave 2 (Hono → Elysia port).
// The full Elysia daemon will replace this in the next port wave.

export function startDaemon(): never {
  throw new Error(
    'arra-indexer daemon: not yet available on main. ' +
    'The Elysia-native daemon (Wave 2 of the alpha→main port) is pending. ' +
    'Track at port/wave2-elysia-api.'
  );
}

if (import.meta.main) {
  startDaemon();
}
