const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const productName = "Billbook";
const sourceApp = path.join(__dirname, "..", "dist", "mac-arm64", `${productName}.app`);
const applicationsDir = path.join(os.homedir(), "Applications");
const targetApp = path.join(applicationsDir, `${productName}.app`);

try {
  execFileSync("test", ["-d", sourceApp], { stdio: "ignore" });
} catch {
  console.error(`Missing app bundle at ${sourceApp}`);
  console.error("Run `npm run build:mac` first.");
  process.exit(1);
}

execFileSync("mkdir", ["-p", applicationsDir], { stdio: "ignore" });
execFileSync("rm", ["-rf", targetApp], { stdio: "ignore" });
execFileSync("ditto", [sourceApp, targetApp], { stdio: "ignore" });

try {
  execFileSync("mdimport", [targetApp], { stdio: "ignore" });
} catch {
  // Spotlight indexing is a best-effort step.
}

console.log(`Installed ${productName}.app to ${targetApp}`);
