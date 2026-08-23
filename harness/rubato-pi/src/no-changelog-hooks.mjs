import { stripChangelog } from "./no-changelog.mjs";
import {
  injectEditorMouse,
  injectEditorMouseRouting,
  isEditorMouseModuleUrl,
  isEditorMouseTuiUrl,
} from "./editor-mouse.mjs";
import { injectTitleGuard, isTerminalModuleUrl, titleGuardHref } from "./title-guard.mjs";
import { busyEnterHref, injectBusyEnter, isBusyEnterModuleUrl } from "./busy-enter.mjs";

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (result.source == null) return result;

  if (isEditorMouseModuleUrl(url) || isEditorMouseTuiUrl(url)) {
    const source = String(result.source);
    const next = isEditorMouseModuleUrl(url) ? injectEditorMouse(source) : injectEditorMouseRouting(source);
    return { format: result.format, source: next, shortCircuit: true };
  }

  if (isTerminalModuleUrl(url)) {
    const source = String(result.source);
    const next = injectTitleGuard(source, titleGuardHref());
    if (next === source) return result;
    return { format: result.format, source: next, shortCircuit: true };
  }

  if (!url.includes("@code-yeongyu/senpi/dist/")) return result;
  const source = String(result.source);
  let next = source;
  if (isBusyEnterModuleUrl(url)) next = injectBusyEnter(next, busyEnterHref());
  next = stripChangelog(next, url);
  if (next === source) return result;
  return { format: result.format, source: next, shortCircuit: true };
}
