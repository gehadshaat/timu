#!/usr/bin/env node
/**
 * One step from a fresh clone to a running Timu: `npm start`.
 *
 * - checks Node, installs dependencies if needed
 * - writes .env.local with generated ingest and MCP tokens, keeping any values you already set
 * - checks for the Claude CLI, which Timu uses (on your login) to file sessions and triage them
 * - builds the app when there's no build for this commit yet, then serves it on PORT (default 3100)
 *
 * The database is a SQLite file (TIMU_DB_PATH, default data/timu.db) that the app creates and migrates
 * on first use, so there is nothing to start. Safe to re-run. Plain Node (no deps) so it works before
 * `npm install`.
 *
 * Modes:
 * - `--start` (`npm start`): everything above, then runs the production server in the foreground.
 * - no flag (`npm run setup`): everything except building and starting.
 * - `--dev` (run by `npm run dev` as predev): only makes sure .env.local exists with tokens. It never
 *   installs, prompts, or fails the dev server.
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = path.join(ROOT, ".env.local");
const EXAMPLE_FILE = path.join(ROOT, ".env.example");
/** Which commit the build in .next came from; a different (or unknown) commit means build again. */
const BUILD_STAMP = path.join(ROOT, ".next", "timu-build");

const DEV = process.argv.includes("--dev");
const START = process.argv.includes("--start");
const PORT = process.env.PORT || "3100";
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

if (lines.join("\n") !== original || !fs.existsSync(ENV_FILE)) {
  step("Writing .env.local…");
  fs.writeFileSync(ENV_FILE, lines.join("\n"));
}

const cli = process.env.CLAUDE_CLI?.trim() || get("CLAUDE_CLI") || "claude";
const hasClaudeCli = cli !== "off" && spawnSync(cli, ["--version"], { stdio: "ignore" }).status === 0;
const url = `http://localhost:${PORT}`;
const notes = `
  Database:   ${process.env.TIMU_DB_PATH || get("TIMU_DB_PATH") || "data/timu.db"}  (SQLite, created on first run)

  Let Claude run Timu (MCP), while Timu is running:
    claude mcp add --transport http timu ${url}/api/mcp --header "Authorization: Bearer ${get("TIMU_MCP_TOKEN")}"
${hasClaudeCli ? "" : cli === "off" ? "\n  CLAUDE_CLI=off, so Timu will use the rules-based organiser.\n" : "\n  The Claude CLI isn't on your PATH, so Timu will use the rules-based organiser.\n  Install Claude Code and run `claude` once to sign in; Timu switches to Claude by itself.\n"}`;

if (!START) {
  console.log(`\n✔ Timu is set up.\n\n  Start it:   npm start   (then open ${url})\n${notes}`);
  process.exit(0);
}

// 4. Build, once per commit. Without git (a downloaded zip) a build is reused until you delete .next.
const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout?.trim() || "unversioned";
const built = fs.existsSync(path.join(ROOT, ".next", "BUILD_ID")) && fs.existsSync(BUILD_STAMP) ? fs.readFileSync(BUILD_STAMP, "utf8").trim() : null;
if (built !== commit || process.argv.includes("--rebuild")) {
  step(built ? "Timu has changed since the last build, building it again (about half a minute)…" : "Building Timu (about half a minute, first run only)…");
  run("npx", ["next", "build"]);
  fs.writeFileSync(BUILD_STAMP, commit);
}

// 5. Serve it
console.log(`\n✔ Timu is running at ${url}   (the setup wizard runs on first visit; Ctrl+C stops it)\n${notes}`);
const server = spawn("npx", ["next", "start", "-p", PORT], { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.kill(sig));
server.on("exit", (code) => process.exit(code ?? 0));
