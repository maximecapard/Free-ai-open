import type { ModelBenchmarkStore } from "./store";

// PACKAGE-PRIVATE nominal trust for benchmark persistence. Not exported from
// index.ts, and the registries below are module-private: the only code that can
// add to them is this package's own factories (memory-store.ts,
// indexed-db-store.ts) and ModelBenchmarkStoreClient's constructor.
//
// Why it exists. The benchmark runner makes a promise the type system cannot
// make for it: once a persistence write has been aborted (or has timed out and
// been abandoned), it can no longer mutate storage afterwards. That is a fact
// about a specific STORAGE IMPLEMENTATION, not about a TypeScript shape --
// any object with a `putAndPrune()` method is structurally a
// "ModelBenchmarkStore", including one that ignores its AbortSignal and writes
// later. So the guarantee is attached to NOMINAL identity instead:
//
// - a backend is TRUSTED only if it was produced by one of this package's own
//   factories, whose implementations guarantee cancellation semantics:
//     memory backend  -- the whole write is synchronous after its abort checks,
//                        so an aborted call never mutates, ever;
//     IndexedDB       -- the signal is honored from open() onward (a pre-
//                        aborted signal never opens; an abort during open or an
//                        in-progress upgrade rolls it back; a late open success
//                        is closed inert; once a transaction exists the signal
//                        aborts it and its terminal event is awaited);
// - ModelBenchmarkStoreClient refuses (throws) to wrap an untrusted backend and
//   is not subclassable, so a trusted client is always a trusted backend behind
//   the package's own, unmodified client logic;
// - createModelBenchmarkRunner() accepts only such a client.
//
// The compile-time brand makes an ordinary structural object fail to type-check
// where a trusted store is required; the WeakSets make a cast, a forged
// prototype, or a Proxy fail at runtime too. This cannot stop code that
// deliberately reaches into this module or monkey-patches a client instance --
// nothing in-process can -- but it removes the accidental and structural ways
// of presenting an unsafe store as a safe one.
declare const trustedBackendBrand: unique symbol;

export interface TrustedModelBenchmarkBackendBrand {
  readonly [trustedBackendBrand]: true;
}

export type TrustedModelBenchmarkStore = ModelBenchmarkStore & TrustedModelBenchmarkBackendBrand;

const trustedBackends = new WeakSet<object>();
const trustedClients = new WeakSet<object>();

// Used ONLY by this package's own backend factories.
export function markTrustedBackend(backend: ModelBenchmarkStore): TrustedModelBenchmarkStore {
  trustedBackends.add(backend);
  return backend as TrustedModelBenchmarkStore;
}

export function isTrustedBackend(candidate: unknown): candidate is TrustedModelBenchmarkStore {
  return typeof candidate === "object" && candidate !== null && trustedBackends.has(candidate);
}

// Used ONLY by ModelBenchmarkStoreClient's constructor, after it has verified
// its backend is trusted.
export function markTrustedClient(client: object): void {
  trustedClients.add(client);
}

export function isTrustedStoreClient(candidate: unknown): boolean {
  return typeof candidate === "object" && candidate !== null && trustedClients.has(candidate);
}
