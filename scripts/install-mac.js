const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const productName = "Billbook";
const sourceApp = path.join(__dirname, "..", "dist", "mac-arm64", `${productName}.app`);
const applicationsDir = path.join(os.homedir(), "Applications");
const targetApp = path.join(applicationsDir, `${productName}.app`);

if (!fs.existsSync(sourceApp)) {
  console.error(`Missing app bundle at ${sourceApp}`);
  console.error("Run `npm run build:mac` first.");
  process.exit(1);
}

fs.mkdirSync(applicationsDir, { recursive: true });
fs.rmSync(targetApp, { recursive: true, force: true });
fs.cpSync(sourceApp, targetApp, { recursive: true });

try {
  execFileSync("mdimport", [targetApp], { stdio: "ignore" });
} catch {
  // Spotlight indexing is a best-effort step.
}

console.log(`Installed ${productName}.app to ${targetApp}`);
