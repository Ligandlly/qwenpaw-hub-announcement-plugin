import { build } from "esbuild";

// The Console injects React through window.QwenPaw.host, so the bundle has no
// bare react import at all. JSX compiles to React.createElement calls against
// the locally bound host instance (classic runtime).
//
// `iife` (not `esm`) on purpose: the artifact is pure side effects — it
// registers itself with window.QwenPaw on load — and this way it runs whether
// the console loads it as a blob-URL module or as a classic script.
await build({
  entryPoints: ["src/index.tsx"],
  bundle: true,
  format: "iife",
  target: ["es2020"],
  jsx: "transform",
  outfile: "dist/index.js",
  legalComments: "none",
  minify: true,
  sourcemap: false,
  logLevel: "info",
});
