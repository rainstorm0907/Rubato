import { stripChangelog } from "./no-changelog.mjs";
import { injectTitleGuard, isTerminalModuleUrl, titleGuardHref } from "./title-guard.mjs";

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (result.source == null) return result;

  if (isTerminalModuleUrl(url)) {
    const source = String(result.source);
    const next = injectTitleGuard(source, titleGuardHref());
    if (next === source) return result;
    return { format: result.format, source: next, shortCircuit: true };
  }

  if (!url.includes("@code-yeongyu/senpi/dist/")) return result;
  const source = String(result.source);
  const next = stripChangelog(source, url);
  if (next === source) return result;
  return { format: result.format, source: next, shortCircuit: true };
}
