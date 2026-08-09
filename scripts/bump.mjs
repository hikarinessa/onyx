#!/usr/bin/env node
/**
 * Version bump script — keeps package.json, src-tauri/Cargo.toml, and
 * src-tauri/tauri.conf.json in sync, then refreshes package-lock.json.
 *
 * Usage:
 *   npm run bump 0.11.0     # set explicit version
 *   npm run bump patch      # 0.10.9 -> 0.10.10
 *   npm run bump minor      # 0.10.9 -> 0.11.0
 *   npm run bump major      # 0.10.9 -> 1.0.0
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = resolve(root, "package.json");
const cargoPath = resolve(root, "src-tauri/Cargo.toml");
const tauriConfPath = resolve(root, "src-tauri/tauri.conf.json");

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const current = pkg.version;

const arg = process.argv[2];
if (!arg) {
  console.error(`Current version: ${current}\nUsage: npm run bump <version|patch|minor|major>`);
  process.exit(1);
}

let next;
if (/^\d+\.\d+\.\d+$/.test(arg)) {
  next = arg;
} else {
  const [maj, min, pat] = current.split(".").map(Number);
  if (arg === "patch") next = `${maj}.${min}.${pat + 1}`;
  else if (arg === "minor") next = `${maj}.${min + 1}.0`;
  else if (arg === "major") next = `${maj + 1}.0.0`;
  else {
    console.error(`Invalid argument: ${arg} (expected x.y.z, patch, minor, or major)`);
    process.exit(1);
  }
}

// package.json
pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

// Cargo.toml — only the [package] version line (first `version = "..."`)
const cargo = readFileSync(cargoPath, "utf8");
writeFileSync(cargoPath, cargo.replace(/^version = ".*"$/m, `version = "${next}"`));

// tauri.conf.json
const tauriConf = JSON.parse(readFileSync(tauriConfPath, "utf8"));
tauriConf.version = next;
writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + "\n");

// Refresh lockfile version field
execSync("npm install --package-lock-only", { cwd: root, stdio: "inherit" });

console.log(`\nBumped ${current} -> ${next}`);
console.log("Note: Cargo.lock updates on the next cargo build/check.");
console.log("Don't forget docs/CHANGELOG.md and the CLAUDE.md version line.");
