// Forwards conversation batches from the claude.ai content script to the Timu server.

async function settings() {
  const stored = await chrome.storage.sync.get(["timuUrl", "token"]);
  const timuUrl = (stored.timuUrl || "http://localhost:3100").replace(/\/+$/, "");
  // A local Timu's live token wins over the saved one, so a regenerated .env.local is picked up on the next sync.
  return { timuUrl, token: (await fetchLocalToken(timuUrl)) || stored.token || "" };
}

// A local Timu (no password) hands its ingest token to the extension, so there's nothing to paste.
async function fetchLocalToken(timuUrl) {
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(timuUrl)) return "";
  try {
    const res = await fetch(`${timuUrl}/api/ingest/token`, { cache: "no-store" });
    const { token = "" } = res.ok ? await res.json() : {};
    return token;
  } catch {
    return "";
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === "timu-settings") {
    settings().then(reply);
    return true;
  }
  if (msg?.type !== "timu-ingest") return false;
  (async () => {
    const { timuUrl, token } = await settings();
    if (!token) return reply({ ok: false, error: "Start Timu (npm run dev), or set your Timu token in the extension popup." });
    try {
      const res = await fetch(`${timuUrl}/api/ingest/claude-ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ conversations: msg.conversations }),
      });
      const body = await res.json().catch(() => ({}));
      reply(res.ok ? { ok: true, ...body } : { ok: false, error: body.error ?? `Timu returned ${res.status}` });
    } catch (err) {
      reply({ ok: false, error: `Can't reach Timu at ${timuUrl}: ${err}` });
    }
  })();
  return true;
});
