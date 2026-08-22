const QUESTION_MODULE_SUFFIX = '/web-ai/question.mjs';
const CHATGPT_MODEL_MODULE_SUFFIX = '/web-ai/chatgpt-model.mjs';
const RAW_PROMPT_ENV = 'CONSULT_AGBROWSE_RAW_PROMPT';
const FUNCTION_MARKER = 'function renderNormalizedEnvelope(envelope) {\n    const blocks = [];';
const COMPOSER_PILL_CLICK_MARKER = `            await composerPill.click({ timeout: 5_000 });
            await page.waitForTimeout(400).catch(() => undefined);
            if (await isModelMenuOpen(page)) {
                await assertOpenMenuIsNotWorkPicker(page);
                return;
            }`;
const COMPOSER_PILL_POINTER_FALLBACK = `${COMPOSER_PILL_CLICK_MARKER}
            // ChatGPT's current composer pill can ignore Playwright's locator
            // click while still accepting a real pointer event at its center.
            // Keep this scoped to the already-verified composer model pill and
            // only try it after the ordinary click failed to open a model menu.
            const composerPillBox = await composerPill.boundingBox().catch(() => null);
            if (composerPillBox) {
                usedFallbacks.push('composer-model-pill-pointer');
                await page.mouse.click(
                    composerPillBox.x + composerPillBox.width / 2,
                    composerPillBox.y + composerPillBox.height / 2,
                ).catch(() => undefined);
                await page.waitForTimeout(400).catch(() => undefined);
                if (await isModelMenuOpen(page)) {
                    await assertOpenMenuIsNotWorkPicker(page);
                    return;
                }
            }`;
const POWER_PICKER_ROOT_MARKER = `const CHATGPT_POWER_PICKER_ROOT_SELECTOR =
    '[role="menu"][data-state="open"]:has([role="menuitem"][aria-label="Power"])';`;
// agbrowse 0.2.x identifies the live Chat Power shell by the Power menuitem.
// Do not rewrite that root to retired content-testid selectors: the current
// shell has no composer-intelligence-picker-content node, so a rewritten
// root never matches, open-detection stays false, and the next click toggles
// the already-open menu shut.
const POWER_PICKER_ROOT_CURRENT = `const CHATGPT_POWER_PICKER_ROOT_SELECTOR =
    '[role="menu"][data-state="open"]:has([role="menuitem"][aria-label="Power"]), [role="menu"][data-state="open"]:has([role="menuitem"][aria-label="성능"])';`;
const MODEL_SURFACE_PREFLIGHT_MARKER = `async function assertChatSurfaceForModelMutation(page) {
    const { detectChatGptComposerSurface } = await import('./product-surfaces.mjs');`;
const MODEL_SURFACE_PREFLIGHT_CURRENT = `async function assertChatSurfaceForModelMutation(page) {
    // ChatGPT may rate-limit conversation-history access on a freshly opened
    // tab. Do not acknowledge and continue: another attempt can extend the
    // account-protection window, and the provider explicitly asks us to wait.
    const historyRateLimitModal = page.locator(
        '[data-testid="modal-conversation-history-rate-limit"]',
    ).first();
    if (await historyRateLimitModal.isVisible().catch(() => false)) {
        throw new WebAiError({
            errorCode: 'provider.rate-limited',
            stage: 'provider-surface-preflight',
            vendor: 'chatgpt',
            retryHint: 'wait',
            message: 'ChatGPT temporarily limited conversation-history access; wait a few minutes before retrying',
            evidence: { modal: 'modal-conversation-history-rate-limit' },
        });
    }
    const { detectChatGptComposerSurface } = await import('./product-surfaces.mjs');`;

const RAW_PROMPT_BRANCH = `function renderNormalizedEnvelope(envelope) {
    if (process.env.${RAW_PROMPT_ENV} === '1') {
        const composerText = envelope.question || envelope.prompt;
        if (composerText.length > INLINE_CHAR_LIMIT) {
            throw new WebAiError({
                errorCode: 'context.over-budget',
                stage: 'context-preflight',
                retryHint: 'reduce-files',
                message: \`inline prompt too large: \${composerText.length}/\${INLINE_CHAR_LIMIT} chars\`,
                evidence: { length: composerText.length, limit: INLINE_CHAR_LIMIT },
            });
        }
        return {
            markdown: composerText,
            composerText,
            estimatedChars: composerText.length,
            warnings: [],
        };
    }
    const blocks = [];`;

export async function load(url, context, nextLoad) {
    const result = await nextLoad(url, context);
    if (process.env[RAW_PROMPT_ENV] !== '1') {
        return result;
    }

    const source = String(result.source);
    if (url.endsWith(QUESTION_MODULE_SUFFIX)) {
        if (!source.includes(FUNCTION_MARKER) || !source.includes("renderTrustedSection('USER'")) {
            throw new Error(
                'Consult raw-prompt transport is incompatible with this agbrowse question renderer; ' +
                'verify the installed agbrowse release before sending.',
            );
        }

        return {
            ...result,
            source: source.replace(FUNCTION_MARKER, RAW_PROMPT_BRANCH),
        };
    }

    if (url.endsWith(CHATGPT_MODEL_MODULE_SUFFIX)) {
        if (!source.includes(COMPOSER_PILL_CLICK_MARKER)
            || !source.includes(POWER_PICKER_ROOT_MARKER)
            || !source.includes(MODEL_SURFACE_PREFLIGHT_MARKER)) {
            throw new Error(
                'Consult model-picker compatibility patch does not match this agbrowse release; ' +
                'verify the installed agbrowse release before sending.',
            );
        }
        const patched = source
            .replace(COMPOSER_PILL_CLICK_MARKER, COMPOSER_PILL_POINTER_FALLBACK)
            .replace(POWER_PICKER_ROOT_MARKER, POWER_PICKER_ROOT_CURRENT)
            .replace(MODEL_SURFACE_PREFLIGHT_MARKER, MODEL_SURFACE_PREFLIGHT_CURRENT)
            .replaceAll(
                `root.locator('[role="menuitem"][aria-label="Power"]')`,
                `root.locator('[role="menuitem"][aria-label="Power"], [role="menuitem"][aria-label="성능"]')`,
            )
            .replaceAll(
                `page.locator('[role="menuitem"][aria-label="Power"]')`,
                `page.locator('[role="menuitem"][aria-label="Power"], [role="menuitem"][aria-label="성능"]')`,
            )
            .replace(
                `hasModel ||= menuTextHasExactLine(text, 'Model');`,
                `hasModel ||= menuTextHasExactLine(text, 'Model') || menuTextHasExactLine(text, '모델');`,
            )
            .replace(
                `hasEffort ||= menuTextHasExactLine(text, 'Effort');`,
                `hasEffort ||= menuTextHasExactLine(text, 'Effort') || menuTextHasExactLine(text, '추론 강도');`,
            )
            .replace(
                `if (menuTextHasExactLine(text, heading)) return trigger;`,
                `if (menuTextHasExactLine(text, heading)
                    || (heading === 'Model' && menuTextHasExactLine(text, '모델'))
                    || (heading === 'Effort' && menuTextHasExactLine(text, '추론 강도'))) return trigger;`,
            );
        return {
            ...result,
            source: patched,
        };
    }

    return result;
}
