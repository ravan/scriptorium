// Tests for the one property of setup.ts that is easy to break and expensive to
// discover: a bundled skill must be a REAL copy inside the wiki.
//
// The whole point of bundling is that the user opens the wiki folder on its own,
// with no access to wherever the skills were installed. If a skill is installed
// as a symlink (the normal way to develop several skill repos side by side),
// cpSync copies the *link*, and the wiki silently depends on a path outside
// itself. It still works on the author's machine, which is why this needs a test
// rather than a spot check.
import { describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const SETUP = join(import.meta.dir, "setup.ts");
const SKILL_ROOT = dirname(import.meta.dir); // skills/wiki

/** A throwaway tree: a fake skills dir holding one real skill and one symlinked skill. */
function scaffold() {
  const tmp = mkdtempSync(join(tmpdir(), "wiki-setup-"));
  const elsewhere = join(tmp, "elsewhere", "skills");
  const skills = join(tmp, "skills");
  mkdirSync(elsewhere, { recursive: true });
  mkdirSync(skills, { recursive: true });

  // A skill living somewhere else entirely, exposed by symlink - the shape that broke.
  const realSkill = join(elsewhere, "linked-skill");
  mkdirSync(realSkill, { recursive: true });
  writeFileSync(join(realSkill, "SKILL.md"), "---\nname: linked-skill\n---\n# Linked\n");
  mkdirSync(join(realSkill, "scripts"), { recursive: true });
  writeFileSync(join(realSkill, "scripts", "thing.ts"), "export const x = 1;\n");
  symlinkSync(realSkill, join(skills, "linked-skill"));

  // A skill that is a plain directory, for contrast.
  const plainSkill = join(skills, "plain-skill");
  mkdirSync(plainSkill, { recursive: true });
  writeFileSync(join(plainSkill, "SKILL.md"), "---\nname: plain-skill\n---\n# Plain\n");

  // Stub idiolect and hogwash so setup finds them locally. Without these, setup
  // correctly falls through to `npx skills add ravan/hogwash`, which needs the
  // network - and this suite is offline by contract. Tests that care about these
  // two overwrite the stubs with whatever shape they are testing.
  for (const s of ["idiolect", "hogwash"]) {
    const d = join(skills, s);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "SKILL.md"), `---\nname: ${s}\n---\n# ${s} stub\n`);
  }

  return { tmp, skills, elsewhere };
}

/** Run setup.ts as the real CLI, with skillRoot pointed at a copy inside the fake tree. */
async function runSetup(fakeSkills: string, wiki: string, bundle: string) {
  // setup.ts derives skillsRoot from its own location, so it has to run from a
  // copy that sits at <fakeSkills>/wiki/scripts/setup.ts.
  const fakeWikiSkill = join(fakeSkills, "wiki", "scripts");
  mkdirSync(fakeWikiSkill, { recursive: true });
  writeFileSync(join(fakeWikiSkill, "setup.ts"), readFileSync(SETUP, "utf8"));
  for (const f of ["common.ts"]) {
    const src = join(SKILL_ROOT, "scripts", f);
    if (existsSync(src)) writeFileSync(join(fakeWikiSkill, f), readFileSync(src, "utf8"));
  }
  const proc = Bun.spawn(
    ["bun", join(fakeWikiSkill, "setup.ts"), wiki, "--name", "T", "--bundle-skills", bundle],
    { stdout: "pipe", stderr: "pipe" },
  );
  await proc.exited;
  return {
    out: await new Response(proc.stdout).text(),
    err: await new Response(proc.stderr).text(),
  };
}

describe("setup.ts bundling", () => {
  test("REGRESSION: a symlinked skill is bundled as a real copy, not a link", async () => {
    const { tmp, skills } = scaffold();
    const wiki = join(tmp, "my-wiki");
    await runSetup(skills, wiki, "linked-skill,plain-skill");

    for (const s of ["linked-skill", "plain-skill"]) {
      const dst = join(wiki, ".claude", "skills", s);
      expect(existsSync(join(dst, "SKILL.md"))).toBe(true);
      // The point of the test: not a symlink.
      expect(lstatSync(dst).isSymbolicLink()).toBe(false);
      expect(lstatSync(dst).isDirectory()).toBe(true);
    }
  }, 30_000);

  test("a bundled symlinked skill brings its nested files across", async () => {
    const { tmp, skills } = scaffold();
    const wiki = join(tmp, "my-wiki");
    await runSetup(skills, wiki, "linked-skill");

    const nested = join(wiki, ".claude", "skills", "linked-skill", "scripts", "thing.ts");
    expect(existsSync(nested)).toBe(true);
    expect(readFileSync(nested, "utf8")).toContain("export const x");
  }, 30_000);

  test("the bundled copy survives the original being unreachable", async () => {
    // Proves self-containment rather than merely asserting the file type: after
    // the source tree is gone, the wiki must still hold a readable skill.
    const { tmp, skills, elsewhere } = scaffold();
    const wiki = join(tmp, "my-wiki");
    await runSetup(skills, wiki, "linked-skill");

    // Break the link target the way moving or deleting a sibling repo would.
    const { renameSync } = await import("node:fs");
    renameSync(join(elsewhere, "linked-skill"), join(elsewhere, "linked-skill-moved"));

    const bundled = join(wiki, ".claude", "skills", "linked-skill", "SKILL.md");
    expect(existsSync(bundled)).toBe(true);
    expect(readFileSync(bundled, "utf8")).toContain("name: linked-skill");
  }, 30_000);

  test("both voice skills are bundled from a local install when one exists", async () => {
    // idiolect owns profiles/, hogwash scans and rewrites against them. Both ship
    // from ravan/hogwash, and a local copy must win so a machine that is editing
    // them is never overwritten by the published version.
    const { tmp, skills } = scaffold();
    for (const s of ["idiolect", "hogwash"]) {
      const d = join(skills, s);
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, "SKILL.md"), `---\nname: ${s}\n---\n# ${s}\n`);
    }
    const wiki = join(tmp, "my-wiki");
    await runSetup(skills, wiki, "");

    for (const s of ["idiolect", "hogwash"]) {
      const dst = join(wiki, ".claude", "skills", s);
      expect(existsSync(join(dst, "SKILL.md"))).toBe(true);
      expect(lstatSync(dst).isSymbolicLink()).toBe(false);
      expect(readFileSync(join(dst, "SKILL.md"), "utf8")).toContain(`name: ${s}`);
    }
  }, 30_000);

  test("a symlinked voice skill is still bundled as a real copy", async () => {
    // The development-machine shape: idiolect/hogwash symlinked in from the
    // repo where they are being edited.
    const { tmp, skills, elsewhere } = scaffold();
    for (const s of ["idiolect", "hogwash"]) {
      const real = join(elsewhere, s);
      mkdirSync(real, { recursive: true });
      writeFileSync(join(real, "SKILL.md"), `---\nname: ${s}\n---\n# ${s}\n`);
      rmSync(join(skills, s), { recursive: true, force: true }); // drop the stub
      symlinkSync(real, join(skills, s));
    }
    const wiki = join(tmp, "my-wiki");
    await runSetup(skills, wiki, "");

    for (const s of ["idiolect", "hogwash"]) {
      const dst = join(wiki, ".claude", "skills", s);
      expect(lstatSync(dst).isSymbolicLink()).toBe(false);
      expect(existsSync(join(dst, "SKILL.md"))).toBe(true);
    }
  }, 30_000);

  test("a missing skill warns instead of failing the run", async () => {
    const { tmp, skills } = scaffold();
    const wiki = join(tmp, "my-wiki");
    const { out, err } = await runSetup(skills, wiki, "no-such-skill");
    expect(err + out).toContain("no-such-skill");
    expect(existsSync(join(wiki, "CLAUDE.md")) || out.includes("ready")).toBe(true);
  }, 30_000);
});

describe("setup.ts does not write through a stale symlink", () => {
  test("REGRESSION: a symlinked destination is replaced, not written into", async () => {
    // An older buggy run left .claude/skills/<s> as a symlink into the skill's
    // own repo. Copying into that link would edit the source repo in place.
    const { tmp, skills, elsewhere } = scaffold();
    const wiki = join(tmp, "my-wiki");
    const dstDir = join(wiki, ".claude", "skills");
    mkdirSync(dstDir, { recursive: true });
    symlinkSync(join(elsewhere, "linked-skill"), join(dstDir, "linked-skill"));

    const canary = join(elsewhere, "linked-skill", "canary.txt");
    writeFileSync(canary, "original\n");

    await runSetup(skills, wiki, "linked-skill");

    // The destination is now a real directory...
    expect(lstatSync(join(dstDir, "linked-skill")).isSymbolicLink()).toBe(false);
    // ...and the source repo was not written into beyond what it already had.
    expect(readFileSync(canary, "utf8")).toBe("original\n");
    expect(existsSync(join(elsewhere, "linked-skill", ".claude"))).toBe(false);
  }, 30_000);
});
