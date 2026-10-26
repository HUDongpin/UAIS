import type { Reporter, TestCase, TestResult, TestStep, FullResult } from "@playwright/test/reporter";
/** Raw Playwright call logs can contain fill() values or authenticated headers.
 * Emit only known phase names/status. Detailed evidence is explicitly allowlisted
 * by the test; never persist traces, cookies, request bodies, or raw errors. */
export default class ClassroomReporter implements Reporter {
  onStepBegin(_test: TestCase, _result: TestResult, step: TestStep) {
    if (step.category === "test.step" && step.title.startsWith("Classroom: ")) console.log(step.title);
  }
  onTestEnd(_test: TestCase, result: TestResult) { console.log(`Classroom acceptance: ${result.status}; ${Math.round(result.duration / 1000)} seconds. See sanitized summary.json for the last phase.`); }
  onEnd(result: FullResult) { console.log(`Classroom run: ${result.status}. Authentication data and raw call logs are intentionally not reported.`); }
}
