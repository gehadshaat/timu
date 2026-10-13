const $ = (id) => document.getElementById(id);
const status = (t) => ($("status").textContent = t);

async function load() {
  const { timuUrl = "http://localhost:3100", token = "" } = await chrome.storage.sync.get(["timuUrl", "token"]);
  $("url").value = timuUrl;
  // background.js prefers a local Timu's live token; show that one so the field is never stale.
  const res = await chrome.runtime.sendMessage({ type: "timu-settings" }).catch(() => null);
  $("token").value = res?.token || token;
  const { lastSync } = await chrome.storage.local.get("lastSync");
  if (lastSync) status(lastSync.error ? `Last sync failed: ${lastSync.error}` : `Last sync ${new Date(lastSync.at).toLocaleString()} · ${lastSync.sent} chats`);
}

async function save() {
  const timuUrl = $("url").value.trim() || "http://localhost:3100";
  const origin = new URL(timuUrl).origin + "/*";
  // Hosted Timu (not localhost) needs a host permission for that origin.
  if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(timuUrl)) {
    const granted = await chrome.permissions.request({ origins: [origin] });
    if (!granted) return status("Permission to reach that URL was declined.");
  }
  await chrome.storage.sync.set({ timuUrl, token: $("token").value.trim() });
  status("Saved.");
}

async function syncNow() {
  await save();
  let [tab] = await chrome.tabs.query({ url: "https://claude.ai/*" });
  if (!tab) {
    status("Open claude.ai in a tab (signed in), then try again.");
    chrome.tabs.create({ url: "https://claude.ai/recents" });
    return;
  }
  status("Syncing… (first sync can take a few minutes)");
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: "timu-sync", full: false });
    status(res?.ok ? `Synced ${res.sent} chats.` : `Sync failed: ${res?.error}`);
  } catch {
    status("Reload your claude.ai tab once so the extension can attach, then retry.");
  }
}

$("save").addEventListener("click", save);
$("sync").addEventListener("click", syncNow);
load();
