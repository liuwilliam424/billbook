const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const rootDirectory = path.join(__dirname, "..");
const sourceImage = path.join(rootDirectory, "imgs", "wizard_stick.jpg");
const outputIcon = path.join(rootDirectory, "imgs", "billbook.icns");
const iconsetDirectory = path.join(os.tmpdir(), `billbook-iconset-${process.pid}.iconset`);
const normalizedImage = path.join(os.tmpdir(), `billbook-icon-normalized-${process.pid}.png`);

const iconsetEntries = [
  ["icon_16x16.png", 16],
  ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32],
  ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128],
  ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256],
  ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512],
  ["icon_512x512@2x.png", 1024]
];

function run(command, args) {
  execFileSync(command, args, { stdio: "inherit" });
}

async function buildIcon() {
  if (!fs.existsSync(sourceImage)) {
    throw new Error(`Missing source image at ${sourceImage}`);
  }

  await fsp.rm(iconsetDirectory, { recursive: true, force: true });
  await fsp.rm(normalizedImage, { force: true });
  await fsp.mkdir(iconsetDirectory, { recursive: true });

  // Tighten the source art so the figure fills the app icon more naturally,
  // then pad it back to a square white canvas before generating the iconset.
  run("sips", [
    "-s",
    "format",
    "png",
    "-c",
    "560",
    "420",
    "--cropOffset",
    "0",
    "90",
    sourceImage,
    "--out",
    normalizedImage
  ]);

  run("sips", [
    "-p",
    "600",
    "600",
    "--padColor",
    "FFFFFF",
    normalizedImage,
    "--out",
    normalizedImage
  ]);

  for (const [filename, size] of iconsetEntries) {
    run("sips", [
      "-s",
      "format",
      "png",
      "-z",
      String(size),
      String(size),
      normalizedImage,
      "--out",
      path.join(iconsetDirectory, filename)
    ]);
  }

  run("iconutil", ["-c", "icns", iconsetDirectory, "-o", outputIcon]);
  await fsp.rm(iconsetDirectory, { recursive: true, force: true });
  await fsp.rm(normalizedImage, { force: true });

  console.log(`Built icon at ${outputIcon}`);
}

buildIcon().catch(async (error) => {
  await fsp.rm(iconsetDirectory, { recursive: true, force: true });
  await fsp.rm(normalizedImage, { force: true });
  console.error(error.message || error);
  process.exit(1);
});
