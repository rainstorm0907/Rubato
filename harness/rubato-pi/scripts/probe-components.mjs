#!/usr/bin/env node
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as enginePaths from "../src/engine-paths.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const omoExt = enginePaths.omoExtension;
const mod = await import(omoExt);
const components = mod.omoSenpiComponents;
if (!Array.isArray(components)) {
  console.error("omoSenpiComponents missing", Object.keys(mod));
  process.exit(1);
}
console.log(JSON.stringify({
  keys: Object.keys(mod),
  names: components.map((c) => c?.name),
}, null, 2));
