import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function readProjectFile(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("B-10 core schema design", () => {
  it("documents the core durable entities, invariants, and migration order", () => {
    const schema = readProjectFile("docs/core-schema-design.md");

    expect(schema).toContain("B-10");
    expect(schema).toContain("provider-neutral");
    expect(schema).toContain("Drizzle table definitions");
    expect(schema).toContain("Use one durable database as the system of record");
    expect(schema).toContain("migrations/0001_core_poc.sql");
    expect(schema).toContain("Migration Order");

    for (const entity of [
      "`users`",
      "`courses`",
      "`lessons`",
      "`classes`",
      "`invite_codes`",
      "`enrollments`",
      "`assessments`",
      "`submissions`",
      "`learning_events`",
      "`learner_profiles`",
      "`recommendations`",
    ]) {
      expect(schema).toContain(entity);
    }

    for (const invariant of [
      "Demo credentials must not be production users.",
      "One active enrollment per user/course/class.",
      "AI feedback is advisory metadata, not the authoritative grade.",
      "LLM text may explain a recommendation",
      "Remove the old JSON/file path only after rollback is documented and tested.",
    ]) {
      expect(schema).toContain(invariant);
    }
  });

  it("links the schema contract from operator-facing docs", () => {
    const readme = readProjectFile("README.md");
    const architectureMap = readProjectFile("docs/architecture-map.md");

    expect(readme).toContain("docs/core-schema-design.md");
    expect(architectureMap).toContain("docs/core-schema-design.md");
  });
});
