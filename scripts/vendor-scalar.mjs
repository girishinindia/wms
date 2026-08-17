#!/usr/bin/env node
/**
 * Copy Scalar's standalone bundle into public/ so /docs does not depend
 * on a CDN at page load.
 *
 * The default Scalar integration loads its UI from jsDelivr. Three
 * things go wrong with that, and the first one is not hypothetical — it
 * is how this was found:
 *
 *   1. If the network cannot reach jsDelivr, /docs is a BLANK PAGE.
 *      Not an error, not a message — an empty <div id="app">, because
 *      the script that was going to fill it never arrived. Corporate
 *      proxies, offline development and a strict CSP all do this.
 *   2. A third-party script executes on the page that renders your whole
 *      API surface, including any credentials typed into "Try it".
 *   3. The version is pinned in a string in a route handler rather than
 *      in package.json, so `npm audit` and Dependabot never see it.
 *
 * Vendoring the file fixes all three: the version comes from
 * package.json, the asset is served from the same origin, and it is
 * cached by Vercel's CDN like any other static file.
 *
 * Runs from `prebuild`, so a deploy always ships a matching bundle.
 */
import { copyFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

/**
 * Resolved via the package's main entry, not "@scalar/api-reference/
 * package.json" — the package's `exports` map does not expose its own
 * package.json, so resolving that path throws ERR_PACKAGE_PATH_NOT_EXPORTED.
 * dist/index.js is exported, and the bundle sits beside it.
 */
let source;
let packageRoot;
try {
  packageRoot = dirname(dirname(require.resolve("@scalar/api-reference")));
  source = join(packageRoot, "dist/browser/standalone.js");
  statSync(source);
} catch {
  console.warn(
    "[vendor-scalar] @scalar/api-reference is not installed; /docs will " +
      "fall back to the CDN. Run `npm i -D @scalar/api-reference` to " +
      "serve it from this origin instead.",
  );
  process.exit(0);
}

const targetDir = join(process.cwd(), "public", "scalar");
const target = join(targetDir, "standalone.js");
mkdirSync(targetDir, { recursive: true });
copyFileSync(source, target);

const kb = Math.round(statSync(target).size / 1024);
const version = JSON.parse(
  readFileSync(join(packageRoot, "package.json"), "utf8"),
).version;
console.log(`[vendor-scalar] public/scalar/standalone.js  ${kb} KB  (v${version})`);
