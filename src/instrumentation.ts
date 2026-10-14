/** Runs once when the Timu server starts (next dev / next start): starts the timed sync (src/lib/auto-sync.ts). */
export async function register() {
  // The import stays inside this check so the edge bundle leaves the Node-only modules out.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NEXT_PHASE === "phase-production-build") return;
    const { startAutoSync } = await import("./lib/auto-sync");
    startAutoSync();
  }
}
