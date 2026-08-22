import { omoExtension } from "./engine-paths.mjs";

export function omoExtensionPath() {
  return omoExtension;
}

export async function loadOmoExtension() {
  return import(omoExtensionPath());
}
