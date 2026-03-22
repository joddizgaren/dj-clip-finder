/**
 * afterPack.cjs - runs after electron-builder packages the app,
 * before the installer is created.
 *
 * Copies dist/electron/public/ → {appOutDir}/resources/public/
 * because electron-builder's extraResources filter for directories
 * is unreliable; a manual copy is guaranteed to work.
 */
const fs = require("fs");
const path = require("path");

exports.default = async function afterPack(context) {
  const src  = path.resolve("dist", "electron", "public");
  const dest = path.join(context.appOutDir, "resources", "public");

  if (!fs.existsSync(src)) {
    throw new Error(`afterPack: source not found: ${src}`);
  }

  copyDirSync(src, dest);
  console.log(`  • afterPack: copied public/ → ${dest}`);
};

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}
