// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { normalizeLessonPackage, studentLessonContent, activityDraftFromTemplate } from "@/lib/classroom-lessons/domain";
const directory = new URL("../data/classroom-lessons/", import.meta.url);
async function lesson(file: string) { return normalizeLessonPackage(JSON.parse(await readFile(new URL(file, directory), "utf8"))); }

describe("editable classroom mathematics packages", () => {
  it.each(["01-natural-numbers.json", "02-induction.json"])("imports %s through the actual contract and keeps the teacher guide private", async file => {
    const value = await lesson(file);
    expect(value.primaryLocale).toBe("zh-CN");
    expect(value.tasks).toHaveLength(1);
    const task = activityDraftFromTemplate(value.tasks[0], "real-lesson-key", "real-class-key");
    expect(task.targetClassId).toBe("real-class-key");
    expect(task.status).toBe("draft");
    expect(task.aiPolicy).toBe("disabled");
    expect(task.rubric).toHaveLength(3);
    for (const text of [task.title, task.instructions, task.checkpoint.prompt, task.checkpoint.explanation, ...task.rubric.map(item => item.label)]) {
      expect(text["zh-CN"].trim()).not.toBe(""); expect(text["en-US"].trim()).not.toBe("");
      expect(text["en-US"]).not.toBe(text["zh-CN"]);
    }
    const publicValue = studentLessonContent(value);
    expect(publicValue).not.toHaveProperty("teacherGuide");
    expect(publicValue).not.toHaveProperty("tasks");
    expect(JSON.stringify(publicValue)).not.toContain("数学核对来源");
    for (const answer of value.teacherGuide.answers) {
      expect(value.studentContent.questions.some(q => q.id === answer.questionId)).toBe(true);
      expect(JSON.stringify(publicValue)).not.toContain(answer.answer);
    }
  });
  it("checks the counting artifact and identifies the correct violated successor condition", async () => {
    const value = await lesson("01-natural-numbers.json");
    const objects = ["A", "B", "C", "D", "E", "F"];
    const oneBased = objects.map((_, i) => i + 1), zeroBased = objects.map((_, i) => i);
    expect(new Set(oneBased).size).toBe(6); expect(new Set(zeroBased).size).toBe(6);
    expect(oneBased).toEqual(zeroBased.map(i => i + 1));
    const newCount = objects.length + 1;
    expect(newCount).toBe(7); expect(newCount - 1).toBe(6);
    const cycle = [1, 2, 0];
    expect(new Set(cycle).size).toBe(3); // The cycle IS injective; that is not the failed axiom.
    expect(cycle[2]).toBe(0);
    expect(value.teacherGuide.answers.find(a => a.questionId === "cycle-model")?.answer).toContain("仍是单射");
    expect(value.tasks[0].checkpoint).toMatchObject({ correctOptionId: "b" });
  });
  it("checks the finite arithmetic examples and the polynomial counterexample exactly", async () => {
    const value = await lesson("02-induction.json");
    const polynomial = (n: number) => n * n + n + 41;
    const prime = (n: number) => n > 1 && !Array.from({ length: Math.max(0, Math.floor(Math.sqrt(n)) - 1) }, (_, i) => i + 2).some(d => n % d === 0);
    expect([0, 1, 2, 3, 4].map(polynomial)).toEqual([41, 43, 47, 53, 61]);
    expect([0, 1, 2, 3, 4].map(polynomial).every(prime)).toBe(true);
    expect(polynomial(40)).toBe(41 * 41); expect(prime(polynomial(40))).toBe(false);
    expect(value.teacherGuide.notes).toContain("1681=41²");
  });
  it("checks base cases and symbolic coefficient identities underlying both induction steps", async () => {
    const value = await lesson("02-induction.json");
    // Coefficients are [constant, k, k²]; comparing them is an exact polynomial
    // identity check. Finite samples below are arithmetic checks, not proofs.
    const add = (a: number[], b: number[]) => a.map((coefficient, i) => coefficient + b[i]);
    expect(add([0, 1, 1], [2, 2, 0])).toEqual([2, 3, 1]); // k(k+1)+2(k+1)=(k+1)(k+2).
    expect(add([0, 0, 1], [1, 2, 0])).toEqual([1, 2, 1]); // k²+(2k+1)=(k+1)².
    expect(0 * (0 + 1)).toBe(0); expect(0 ** 2).toBe(0);
    let evenSum = 0, oddSum = 0;
    for (let n = 1; n <= 100; n++) { evenSum += 2 * n; oddSum += 2 * n - 1; expect(evenSum).toBe(n * (n + 1)); expect(oddSum).toBe(n * n); }
    expect(value.teacherGuide.answers.find(a => a.questionId === "odd-sum-proof")?.answer).toContain("取任意 k≥0");
    expect(value.tasks[0].checkpoint).toMatchObject({ correctOptionId: "even" });
  });
  it("verifies the logical countermodel to reversed induction and the step-two checkpoint", async () => {
    const value = await lesson("02-induction.json");
    const P = (n: number) => n === 0;
    const implies = (a: boolean, b: boolean) => !a || b;
    expect(P(0)).toBe(true); expect(P(1)).toBe(false);
    for (let k = 0; k < 20; k++) expect(implies(P(k + 1), P(k))).toBe(true);
    const even = (n: number) => n % 2 === 0;
    for (let k = 0; k < 20; k++) expect(implies(even(k), even(k + 2))).toBe(true);
    expect(even(0)).toBe(true); expect(even(1)).toBe(false);
    expect(value.teacherGuide.answers.find(a => a.questionId === "proof-direction")?.answer).toContain('“n=0”');
  });
});
