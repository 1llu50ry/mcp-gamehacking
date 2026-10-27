// Dashboard API client — barrel re-exporting the aggregated client and wire
// types from ./api/* (split per resource module; see lib/api/README-less
// index.ts). Keeps the historical import paths (`../lib/api`, `$lib/api`)
// working unchanged.
export * from "./api/index";
