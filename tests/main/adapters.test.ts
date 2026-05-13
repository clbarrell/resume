import path from "node:path";
import { describe, expect, it } from "vitest";
import { ampAdapter } from "../../src/main/adapters/amp";
import { claudeAdapter } from "../../src/main/adapters/claude";
import { codexAdapter } from "../../src/main/adapters/codex";
import { piAdapter } from "../../src/main/adapters/pi";

const fixtures = path.join(process.cwd(), "tests", "fixtures");

describe("session adapters", () => {
  it("parses Codex sessions with warnings, files, tools, and resume commands", async () => {
    const result = await codexAdapter.scan([path.join(fixtures, "codex")]);
    expect(result.records).toHaveLength(1);
    expect(result.warningCount).toBe(1);
    expect(result.records[0]).toMatchObject({
      id: "codex one",
      source: "codex",
      title: "Indexed Codex title",
      cwd: "/Users/example/Code/demo app",
      hasParseWarnings: true
    });
    expect(result.records[0].resumeCommand).toBe("codex -C '/Users/example/Code/demo app' resume 'codex one'");
    expect(result.records[0].preview.tools).toContain("rg");
    expect(result.records[0].indexedText).toContain("flaky billing test");
  });

  it("shell-quotes Claude resume commands", async () => {
    const result = await claudeAdapter.scan([path.join(fixtures, "claude")]);
    expect(result.records[0].resumeCommand).toBe("cd '/tmp/quoted '\\'' path' && claude --resume 'claude-one'");
    expect(result.records[0].indexedText).toContain("queue insights copy");
  });

  it("parses Amp thread json", async () => {
    const result = await ampAdapter.scan([path.join(fixtures, "amp")]);
    expect(result.records[0].title).toBe("Amp router refactor");
    expect(result.records[0].resumeCommand).toBe("cd '/Users/example/Code/amp demo' && amp threads continue 'amp-thread-1'");
    expect(result.records[0].preview.files).toContain("app/router.ts");
  });

  it("parses Pi tree sessions and uses session_info name as title", async () => {
    const result = await piAdapter.scan([path.join(fixtures, "pi")]);
    expect(result.records[0].title).toBe("Pi tree session");
    expect(result.records[0].indexedText).toContain("id and parentId");
    expect(result.records[0].indexedText).toContain("Nested Pi messages");
    expect(result.records[0].resumeCommand).toContain("pi --session");
  });
});
