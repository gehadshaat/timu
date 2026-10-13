#!/usr/bin/env node
/**
 * One-command local setup: `npm run setup`.
 *
 * - installs dependencies if needed
 * - writes .env.local with generated ingest and MCP tokens, keeping any values you already set
 * - checks for the Claude CLI, which Timu uses (on your login) to file sessions and triage them
 *
 * The database is a SQLite file (TIMU_DB_PATH, default data/timu.db) that the app creates and migrates
 * on first use, so there is nothing to start. Safe to re-run. Plain Node (no deps) so it works before
 * `npm install`.
 *
 * `--dev` (run by `npm run dev` as predev): only makes sure .env.local exists with tokens. It never
 * installs, prompts, or fails the dev server.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = path.join(ROOT, ".env.local");
const EXAMPLE_FILE = path.join(ROOT, ".env.example");

const DEV = process.argv.includes("--dev");
const step = (msg) => DEV || console.log(`\n🐝 ${msg}`);
const fail = (msg) => {
  if (DEV) {
    console.warn(`🐝 Skipped refreshing .env.local: ${msg}`);
    process.exit(0);
  }
  console.error(`\n✖ ${msg}`);
  process.exit(1);
};
const run = (cmd, args) => {
  const res = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });
  if (res.status !== 0) fail(`\`${cmd} ${args.join(" ")}\` failed.`);
};

// 1. Prerequisites
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 16)) fail(`Node 22.16+ is required for its built-in SQLite (you have ${process.versions.node}).`);

// 2. Dependencies
if (!DEV && !fs.existsSync(path.join(ROOT, "node_modules", ".bin", "next"))) {
  step("Installing dependencies…");
  run("npm", ["install"]);
}

// 3. .env.local: start from the existing file (or the example) and only fill blanks
step("Writing .env.local…");
const original = fs.readFileSync(fs.existsSync(ENV_FILE) ? ENV_FILE : EXAMPLE_FILE, "utf8");
const lines = original.split("\n");
const get = (key) => {
  const line = lines.find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : undefined;
};
const set = (key, value) => {
  const i = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (i >= 0) lines[i] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
};

if (!get("TIMU_INGEST_TOKEN")) set("TIMU_INGEST_TOKEN", randomBytes(24).toString("hex"));
if (!get("TIMU_MCP_TOKEN")) set("TIMU_MCP_TOKEN", randomBytes(24).toString("hex"));


if (DEV) {
  if (lines.join("\n") !== original) {
    fs.writeFileSync(ENV_FILE, lines.join("\n"));
    console.log("🐝 Wrote tokens to .env.local.");
  }
  process.exit(0);
}

fs.writeFileSync(ENV_FILE, lines.join("\n"));

const cli = process.env.CLAUDE_CLI?.trim() || "claude";
const hasClaudeCli = cli !== "off" && spawnSync(cli, ["--version"], { stdio: "ignore" }).status === 0;

console.log(`
✔ Timu is set up.

  Start it:   npm run dev
  Then open:  http://localhost:3100   (the setup wizard runs on first visit)
  Database:   ${get("TIMU_DB_PATH") || "data/timu.db"}  (SQLite, created on first run)

  Let Claude run Timu (MCP), with \`npm run dev\` running:
    claude mcp add --transport http timu http://localhost:3100/api/mcp --header "Authorization: Bearer ${get("TIMU_MCP_TOKEN")}"
${hasClaudeCli ? "" : "\n  The Claude CLI isn't on your PATH, so Timu will use the rules-based organiser.\n  Install Claude Code and run \`claude\` once to sign in; Timu switches to Claude by itself.\n"}`);
