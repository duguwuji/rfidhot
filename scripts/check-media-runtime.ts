// Runs inside the shipped Linux image as well as locally: the native SVG parser must be patched.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { versions } = createRequire(new URL("../packages/backend/package.json", import.meta.url))("sharp") as { versions: Record<string, string> };
const version = versions.rsvg;
assert.ok(version, "sharp must report its librsvg version");
const [major, minor, patch] = version.split(".").map(Number);
assert.ok(major! > 2 || (major === 2 && (minor! > 63 || (minor === 63 && patch! >= 2))), `unpatched librsvg ${version}`);
console.log(`sharp ${versions.sharp}; librsvg ${version}`);
