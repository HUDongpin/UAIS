import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readProjectFile(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("B-19/B-20 performance and accessibility baseline", () => {
  it("keeps the heaviest client pages behind client-owned dynamic shells", () => {
    const teachingShell = readProjectFile("src/components/pages/teaching-page-shell.tsx");
    const learningShell = readProjectFile("src/components/pages/learning-page-shell.tsx");
    const teachingRoute = readProjectFile("src/app/teaching/page.tsx");
    const learningRoute = readProjectFile("src/app/learning/page.tsx");
    const chatroomRoute = readProjectFile("src/app/learning/chatroom/page.tsx");

    expect(teachingShell).toContain('"use client";');
    expect(teachingShell).toContain('from "next/dynamic"');
    expect(teachingShell).toContain("module.TeachingPage");
    expect(teachingShell).toContain("PageLoadingShell");
    expect(learningShell).toContain('"use client";');
    expect(learningShell).toContain('from "next/dynamic"');
    expect(learningShell).toContain("module.LearningPage");
    expect(learningShell).toContain("module.LearningChatroomPage");

    expect(teachingRoute).toContain("TeachingPageShell");
    expect(teachingRoute).not.toContain("@/components/pages/teaching-page\"");
    expect(learningRoute).toContain("LearningPageShell");
    expect(learningRoute).not.toContain("@/components/pages/learning-page\"");
    expect(chatroomRoute).toContain("LearningChatroomPageShell");
    expect(chatroomRoute).not.toContain("@/components/pages/learning-page\"");
  });

  it("keeps dynamic fallbacks accessible and route announcements specific", () => {
    const loadingShell = readProjectFile("src/components/pages/page-loading-shell.tsx");
    const teachingRoute = readProjectFile("src/app/teaching/page.tsx");
    const learningRoute = readProjectFile("src/app/learning/page.tsx");
    const chatroomRoute = readProjectFile("src/app/learning/chatroom/page.tsx");
    const baseline = readProjectFile("docs/performance-accessibility-baseline.md");

    expect(loadingShell).toContain('aria-busy="true"');
    expect(loadingShell).toContain("aria-label={label}");
    expect(teachingRoute).toContain("generateMetadata");
    expect(teachingRoute).toContain("My Teaching | UAIS");
    expect(learningRoute).toContain("generateMetadata");
    expect(learningRoute).toContain("My Learning | UAIS");
    expect(chatroomRoute).toContain("generateMetadata");
    expect(chatroomRoute).toContain("Human-AI Chatroom | UAIS");
    expect(baseline).toContain("Lighthouse");
    expect(baseline).toContain("aria-busy");
  });
});
