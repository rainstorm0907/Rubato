import { describe, expect, it } from "bun:test"
import { compileMemoryBlock } from "./compile"
import { memory, parseCompiledBlock, repoWith } from "./compile.test-support"

// Projection off is the "retrieve on demand" deployment: the repository and the memory tools
// stay live, but nothing from it rides in the prompt. The contract worth pinning is total
// absence — a body that survives here is a per-turn cost the operator asked not to pay.
describe("compileMemoryBlock with projection disabled", () => {
  const fixture = [
    { relativePath: "system/persona.md", content: memory("PERSONA_DESCRIPTION", "PERSONA_BODY_SENTINEL\n") },
    { relativePath: "system/identity.md", content: memory("IDENTITY_DESCRIPTION", "IDENTITY_BODY_SENTINEL\n") },
    { relativePath: "system/human.md", content: memory("HUMAN_DESCRIPTION", "HUMAN_BODY_SENTINEL\n") },
    { relativePath: "system/human/prefs/coding.md", content: memory("PREFS_DESCRIPTION", "PREFS_BODY_SENTINEL\n") },
    { relativePath: "reference/details.md", content: memory("REFERENCE_DESCRIPTION", "EXTERNAL_BODY_SENTINEL\n") },
  ]

  it("#given committed memory of every projected kind #when compiled with projection off #then only structured metadata remains", async () => {
    // given
    const { repo } = await repoWith(fixture)

    // when
    const block = await compileMemoryBlock(repo, { agentId: "agent-golden", projection: false })
    const structure = parseCompiledBlock(block)

    // then
    expect(structure).toEqual({
      sections: ["memory_metadata"],
      projectionPaths: [],
      memoryOpenTags: [],
      metadata: { agentId: "agent-golden" },
    })
  }, 30_000)

  it("#given committed memory #when compiled with projection off #then no body, description, reminder, or external path leaks", async () => {
    // given
    const { repo } = await repoWith(fixture)

    // when
    const block = await compileMemoryBlock(repo, { agentId: "agent-golden", projection: false })

    // then
    for (const sentinel of [
      "PERSONA_BODY_SENTINEL",
      "IDENTITY_BODY_SENTINEL",
      "HUMAN_BODY_SENTINEL",
      "PREFS_BODY_SENTINEL",
      "EXTERNAL_BODY_SENTINEL",
      "PERSONA_DESCRIPTION",
      "HUMAN_DESCRIPTION",
      "REFERENCE_DESCRIPTION",
    ]) {
      expect(block).not.toContain(sentinel)
    }
    // The names-only surfaces and the always-on reminder are projection too.
    expect(block).not.toContain("reference/details.md")
    expect(block).not.toContain("<external_projection>")
    expect(block).not.toContain("$MEMORY_DIR")
    expect(block).not.toContain("Reminder:")
  }, 30_000)

  it("#given the same repository #when compiled with projection on #then those same sentinels are present", async () => {
    // given: the mirror of the assertions above, so a compile that silently stopped projecting
    // anything at all cannot make the disabled-path tests pass for the wrong reason.
    const { repo } = await repoWith(fixture)

    // when
    const block = await compileMemoryBlock(repo, { agentId: "agent-golden" })

    // then
    expect(block).toContain("PERSONA_BODY_SENTINEL")
    expect(block).toContain("HUMAN_BODY_SENTINEL")
    expect(block).toContain("<external_projection>")
    expect(block).toContain("Reminder:")
    expect(block).not.toContain("EXTERNAL_BODY_SENTINEL")
  }, 30_000)

  it("#given projection explicitly enabled #when compiled #then it matches the default", async () => {
    // given
    const { repo } = await repoWith(fixture)

    // when
    const explicit = await compileMemoryBlock(repo, { agentId: "agent-golden", projection: true })
    const implicit = await compileMemoryBlock(repo, { agentId: "agent-golden" })

    // then
    expect(explicit).toBe(implicit)
  }, 30_000)

  it("#given projection off #when compiled #then the repository tree is never read", async () => {
    // given: the cut point is an early return, not a read-then-discard. A compiler that walked
    // HEAD and threw the result away would satisfy every output assertion above while still
    // paying the git cost on every turn, so pin the seam itself.
    const { repo } = await repoWith(fixture)
    const calls: string[] = []
    const recording = Object.create(repo) as typeof repo & { lsTree: unknown; show: unknown }
    recording.lsTree = (...args: unknown[]) => {
      calls.push("lsTree")
      return (repo.lsTree as (...a: unknown[]) => unknown)(...args)
    }
    recording.show = (...args: unknown[]) => {
      calls.push("show")
      return (repo.show as (...a: unknown[]) => unknown)(...args)
    }

    // when
    await compileMemoryBlock(recording, { agentId: "agent-golden", projection: false })

    // then
    expect(calls).toEqual([])

    // and: the same double does record reads when projection is on, so an inert
    // double cannot make the assertion above pass vacuously.
    await compileMemoryBlock(recording, { agentId: "agent-golden" })
    expect(calls).toContain("lsTree")
  }, 30_000)

})
