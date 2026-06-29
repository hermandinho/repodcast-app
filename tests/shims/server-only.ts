// Empty shim — see vitest.config.ts alias. Production builds use the real
// `server-only` sentinel from Next, which throws if imported into a client
// module. Vitest runs the same files in Node and just needs a no-op stand-in.
export {};
