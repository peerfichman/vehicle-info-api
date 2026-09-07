import { build } from "esbuild";

await build({
  entryPoints: ["src/handler.ts"],
  outfile: "dist/handler.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  minify: true,
  // AWS SDK v3 is provided by the Lambda runtime.
  // zod is provided by the Lambda Layer — not the runtime, but our own layer.
  // Both are excluded from the bundle so the function zip stays tiny.
  external: ["@aws-sdk/*", "zod"],
});

console.log("Build complete: dist/handler.js");
