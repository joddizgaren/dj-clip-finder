/**
 * Electron build + package script
 *
 * Run on your Windows machine to produce the installer:
 *
 *   npx tsx script/build.electron.ts
 *
 * Output: release/DJ Clip Studio Setup 1.0.0.exe
 *
 * Prerequisites on the Windows machine:
 *   1. node_modules must be installed: npm install
 *   2. FFmpeg Windows binaries must be in electron/ffmpeg/
 *      Download from: https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip
 *      Extract ffmpeg.exe and ffprobe.exe into the electron/ffmpeg/ folder.
 *   3. An icon must exist at electron/build-resources/icon.ico
 *      (256×256 or larger .ico file — free generators: https://icoconvert.com)
 */

import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, mkdir, copyFile, readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

// Packages that cannot be bundled (native addons, Electron itself)
const ALWAYS_EXTERNAL = ["electron", "better-sqlite3"];

async function getAllPackageNames(): Promise<string[]> {
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const all = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  return all;
}

async function buildAll() {
  console.log("═══════════════════════════════════════");
  console.log("  DJ Clip Studio — Electron Build");
  console.log("═══════════════════════════════════════\n");

  // ── Preflight checks ──────────────────────────────────────────────────────
  const missingPreflight: string[] = [];
  if (!existsSync("electron/ffmpeg/ffmpeg.exe")) {
    missingPreflight.push(
      "  ✗ electron/ffmpeg/ffmpeg.exe not found.\n" +
      "    Download: https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip\n" +
      "    Extract ffmpeg.exe and ffprobe.exe into electron/ffmpeg/"
    );
  }
  if (!existsSync("electron/build-resources/icon.ico")) {
    missingPreflight.push(
      "  ✗ electron/build-resources/icon.ico not found.\n" +
      "    Create a 256×256 .ico file and place it there.\n" +
      "    Free generator: https://icoconvert.com"
    );
  }
  if (missingPreflight.length > 0) {
    console.warn("⚠  Missing items (build will continue but installer may fail):");
    missingPreflight.forEach((m) => console.warn(m));
    console.log();
  }

  // ── 1. Clean output ───────────────────────────────────────────────────────
  await rm("dist/electron", { recursive: true, force: true });
  await mkdir("dist/electron", { recursive: true });
  console.log("✔  Cleaned dist/electron/");

  // ── 2. Build the React frontend ───────────────────────────────────────────
  // Bake Supabase credentials into the bundle so the installer works on any
  // machine without the user needing to set env vars.
  // These are publishable/anon keys — safe to embed in client-side code.
  if (!process.env.VITE_SUPABASE_URL || !process.env.VITE_SUPABASE_ANON_KEY) {
    console.warn(
      "⚠  VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not found in environment.\n" +
      "   Falling back to baked-in publishable keys.\n" +
      "   For production builds, set these env vars before running the build script.\n"
    );
  }
  const supabaseUrl =
    process.env.VITE_SUPABASE_URL ||
    "https://fodnipoqwervrgodouim.supabase.co";
  const supabaseKey =
    process.env.VITE_SUPABASE_ANON_KEY ||
    "sb_publishable_z2I23CmsWY5NK1QSuH-qVw_sU8lju_b";

  console.log("▶  Building frontend (Vite)…");
  await viteBuild({
    build: {
      outDir: "dist/electron/public",
      emptyOutDir: true,
    },
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(supabaseUrl),
      "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(supabaseKey),
    },
  });
  console.log("✔  Frontend → dist/electron/public/\n");

  // ── 3. Bundle the Express server ─────────────────────────────────────────
  console.log("▶  Bundling server…");
  const allPkgs = await getAllPackageNames();
  // Keep all dependencies external — electron-builder will include node_modules.
  // Only better-sqlite3 is "truly" external because it's a native addon.
  const serverExternals = [...new Set([...ALWAYS_EXTERNAL, ...allPkgs])];

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/electron/server.cjs",
    external: serverExternals,
    define: { "process.env.NODE_ENV": '"production"' },
    minify: false,
    logLevel: "info",
  });
  console.log("✔  Server → dist/electron/server.cjs\n");

  // ── 4. Bundle the Electron main process ──────────────────────────────────
  console.log("▶  Bundling Electron main process…");
  await esbuild({
    entryPoints: ["electron/main.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/electron/main.cjs",
    external: ALWAYS_EXTERNAL,
    define: { "process.env.NODE_ENV": '"production"' },
    minify: false,
    logLevel: "info",
  });
  console.log("✔  Main process → dist/electron/main.cjs\n");

  // ── 5. Copy preload ───────────────────────────────────────────────────────
  await copyFile("electron/preload.js", "dist/electron/preload.js");
  console.log("✔  Preload → dist/electron/preload.js\n");

  // ── 6. Run electron-builder ───────────────────────────────────────────────
  console.log("▶  Packaging installer (electron-builder)…");
  const { build: electronBuild } = await import("electron-builder");
  await electronBuild({
    config: {
      appId: "com.joddizgaren.djclipstudio",
      productName: "DJ Clip Studio",
      directories: { output: "release", buildResources: "electron/build-resources" },
      extraMetadata: { main: "dist/electron/main.cjs" },
      files: [
        "dist/electron/main.cjs",
        "dist/electron/preload.js",
        "dist/electron/public/**/*",
        "package.json",
      ],
      extraResources: [
        { from: "dist/electron/server.cjs", to: "server.cjs" },
        { from: "node_modules/better-sqlite3", to: "node_modules/better-sqlite3" },
        ...(existsSync("electron/ffmpeg/ffmpeg.exe")
          ? [{ from: "electron/ffmpeg", to: "ffmpeg" }]
          : []),
      ],
      asarUnpack: ["node_modules/better-sqlite3/**/*"],
      win: {
        icon: existsSync("electron/build-resources/icon.ico")
          ? "electron/build-resources/icon.ico"
          : undefined,
        target: [{ target: "nsis", arch: ["x64"] }],
      },
      nsis: {
        oneClick: false,
        perMachine: false,
        allowToChangeInstallationDirectory: true,
        createDesktopShortcut: true,
        createStartMenuShortcut: true,
        shortcutName: "DJ Clip Studio",
        deleteAppDataOnUninstall: false,
      },
      publish: {
        provider: "github",
        owner: "joddizgaren",
        repo: "dj-clip-finder",
        releaseType: "release",
      },
    },
  });

  console.log("\n✅ Done! Check the release/ folder for the installer .exe");
  console.log(
    "\nTo publish a release:\n" +
    "  1. Commit and push code to GitHub\n" +
    "  2. Create a GitHub release at https://github.com/joddizgaren/dj-clip-finder/releases/new\n" +
    "  3. Upload the .exe from release/ as a release asset\n" +
    "  4. Published! Installed apps will auto-detect and offer the update."
  );
}

buildAll().catch((err) => {
  console.error("\n❌ Build failed:", err.message || err);
  process.exit(1);
});
