// Runs on claude.ai. Reads your conversations with your existing session (same-origin
// requests to claude.ai's own web API) and hands them to the background worker, which
// forwards them to your Timu server. Nothing is sent anywhere except the Timu URL you set.
//
// claude.ai's web API is not a public API; if it changes, use the data export instead.

const PAGE = 50;
const MAX_CONVERSATIONS = 500;
const DETAIL_DELAY_MS = 250;
const BATCH = 20;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path) {
  const res = await fetch(`https://claude.ai/api${path}`, { credentials: "include" });
  if (!res.ok) throw new Error(`claude.ai ${path} → ${res.status}`);
  return res.json();
}

async function currentOrgId() {
  const orgs = await api("/organizations");
  const cookie = document.cookie.match(/lastActiveOrg=([^;]+)/)?.[1];
  const match = orgs.find((o) => o.uuid === cookie);
  return (match ?? orgs.find((o) => (o.capabilities ?? []).includes("chat")) ?? orgs[0])?.uuid;
}

async function sync({ full = false } = {}) {
  const { seen = {} } = await chrome.storage.local.get("seen");
  const org = await currentOrgId();
  if (!org) throw new Error("No claude.ai organization found — are you signed in?");

  // Newest first; stop once we reach conversations we've already sent unchanged.
  const changed = [];
  for (let offset = 0; offset < MAX_CONVERSATIONS; offset += PAGE) {
    const page = await api(`/organizations/${org}/chat_conversations?limit=${PAGE}&offset=${offset}`);
    if (!Array.isArray(page) || page.length === 0) break;
    let reachedSeen = false;
    for (const c of page) {
      if (!full && seen[c.uuid] === c.updated_at) {
        reachedSeen = true;
        continue;
      }
      changed.push(c);
    }
    if (reachedSeen || page.length < PAGE) break;
  }

  let sent = 0;
  for (let i = 0; i < changed.length; i += BATCH) {
    const conversations = [];
    for (const c of changed.slice(i, i + BATCH)) {
      try {
        const detail = await api(
          `/organizations/${org}/chat_conversations/${c.uuid}?tree=True&rendering_mode=messages&render_all_tools=true`,
        );
        conversations.push({
          uuid: detail.uuid,
          name: detail.name,
          summary: detail.summary,
          created_at: detail.created_at,
          updated_at: detail.updated_at,
          project: detail.project ? { uuid: detail.project.uuid, name: detail.project.name } : null,
          chat_messages: (detail.chat_messages ?? []).map((m) => ({
            uuid: m.uuid,
            sender: m.sender,
            created_at: m.created_at,
            text: m.text,
            content: (m.content ?? []).filter((b) => b.type === "text").map((b) => ({ type: "text", text: b.text })),
          })),
        });
      } catch (err) {
        console.warn("[Timu] skipped conversation", c.uuid, err);
      }
      await sleep(DETAIL_DELAY_MS);
    }
    const res = await chrome.runtime.sendMessage({ type: "timu-ingest", conversations });
    if (!res?.ok) throw new Error(res?.error ?? "Timu did not accept the batch");
    for (const c of conversations) seen[c.uuid] = c.updated_at;
    await chrome.storage.local.set({ seen });
    sent += conversations.length;
  }
  return sent;
}

let running = false;
async function run(opts) {
  if (running) return { ok: false, error: "A sync is already running." };
  running = true;
  try {
    const sent = await sync(opts);
    const status = { at: new Date().toISOString(), sent, error: null };
    await chrome.storage.local.set({ lastSync: status });
    return { ok: true, ...status };
  } catch (err) {
    const status = { at: new Date().toISOString(), sent: 0, error: String(err?.message ?? err) };
    await chrome.storage.local.set({ lastSync: status });
    return { ok: false, ...status };
  } finally {
    running = false;
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === "timu-sync") {
    run({ full: !!msg.full }).then(reply);
    return true;
  }
  return false;
});

// Light background sync while claude.ai is open.
run({});
setInterval(() => run({}), 10 * 60 * 1000);
