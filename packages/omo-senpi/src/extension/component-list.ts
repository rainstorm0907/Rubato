import { createAstGrepComponent } from "../components/ast-grep"
import { createCommentCheckerComponent } from "../components/comment-checker"
import { createConfigStartupComponent } from "../components/config-startup"
import { createConfigWatchComponent } from "../components/config-watch"
import { createFallbackArchitectComponent } from "../components/fallback-architect"
import { createGitMasterAttributionComponent } from "../components/git-master"
import { createInitDeepAdvisorComponent } from "../components/init-deep-advisor"
import { createLspComponent } from "../components/lsp"
import { createMemoryComponent } from "../components/memory"
import { createNativeBadgeComponent } from "../components/native-badge"
import { createOnboardingComponent } from "../components/onboarding"
import { createSkillPointersComponent } from "../components/skill-pointers"
import { createStartWorkContinuationComponent } from "../components/start-work-continuation"
import { createOmoNativeTelemetryComponent } from "../components/telemetry"
import { createTodoFanoutReminderComponent } from "../components/todo-fanout-reminder"
import { createUltraworkComponent } from "../components/ultrawork"
import { createUlwLoopComponent } from "../components/ulw-loop"
import type { OmoSenpiComponent } from "./types"

// Rubato: this array is the single place where we choose what runs.
//
// We do NOT delete upstream component sources — every `create*Component` above stays
// imported and buildable. Removing a component here is a one-line change, so an upstream
// merge conflicts in this file only, and the conflict itself is the notification that
// upstream added or reordered a component. See docs/rubato/component-policy.md.
//
// Registration ORDER is meaningful upstream (e.g. start-work-continuation must precede
// ulw-loop so boulder work wins). Keep the surviving entries in upstream's relative order.
export function createOmoSenpiComponents(taskComponent: OmoSenpiComponent): OmoSenpiComponent[] {
  return [
    createAstGrepComponent(),
    createLspComponent(),
    taskComponent,
    createMemoryComponent(),
  ]
}

// Dropped for Rubato, with the reason each one is off. Re-enable by moving the call back
// into the array above at its upstream position.
//
//   native-badge             posts an OMO status badge; collides with the rubato brand
//   onboarding               starts a turn we never asked for on first run
//   init-deep-advisor        preflights the project and runs an advice flow; the first turn
//                            of a team run must be ours
//   telemetry                ships session shape to PostHog
//   ultrawork                injects extra planning/delegation instructions on `ulw`
//   skill-pointers           injects mass-ulw / ulw-plan / ulw-loop / ulw-research skill
//                            pointers on keyword match (same family as the two above)
//   start-work-continuation  nags a settling agent up to 8 times from boulder state;
//                            completion is owned by Taskforce done-evidence
//   ulw-loop                 same, from ulw-loop state
//   todo-fanout-reminder     duplicates our approval gate for delegation decisions
//   git-master               adds a third-party co-author trailer to our commits
//   fallback-architect       changes behaviour on model downgrade, outside our role plan
//   comment-checker          held pending a look at its actual output quality
//   config-startup           loads the `~/.omo` config file. The rubato-pi overlay never reads
//                            that file: it builds the config in code and hands it to the
//                            runtime (harness/rubato-pi/src/omo-config.mjs), so there is
//                            nothing here to load.
//   config-watch             re-reads that same file when it changes on disk. We do not read
//                            it, so there is nothing to watch.
//
// Keep this array and the overlay's ON_COMPONENTS (harness/rubato-pi/src/policy.mjs) saying
// the same thing. They are two gates in series — this one decides what gets bundled at all,
// the overlay decides what it then registers — so a name present here but absent there is
// dead weight shipped in the bundle, and the mismatch reads as a bug later.
