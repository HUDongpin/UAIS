// @vitest-environment node
import { expect, it } from "vitest";
import { createClassroomLocalEnv } from "../scripts/run-classroom-local.mjs";

it("cannot inherit deployment credentials or allow dotenv to refill them", () => {
  const env = createClassroomLocalEnv({
    baseEnv: { PATH: "/bin", HOME: "/tmp", DATABASE_URL: "remote-secret", DEEPSEEK_API_KEY: "private-provider", SENTRY_AUTH_TOKEN: "private-sentry", UNKNOWN_SECRET: "private" },
    fileEnvNames: ["DATABASE_URL", "DEEPSEEK_API_KEY", "UNKNOWN_SECRET", "UAIS_AI_GUIDE_PROVIDER_URL"],
    databaseUrl: "postgres://local@127.0.0.1:54321/uais_classroom_pilot", appSecret: "synthetic-app", teacherSecret: "synthetic-teacher", fixturePath: "/tmp/fixture.json",
  });
  expect(env.DATABASE_URL).toContain("127.0.0.1");
  expect(env.DEEPSEEK_API_KEY).toBe("");
  expect(env.SENTRY_AUTH_TOKEN).toBe("");
  expect(env.UNKNOWN_SECRET).toBe("");
  expect(env.UAIS_AI_GUIDE_PROVIDER_URL).toBe("");
  expect(JSON.stringify(env)).not.toContain("private");
  expect(env.UAIS_APP_AUTH_PROVIDER).toBe("database-accounts");
});
