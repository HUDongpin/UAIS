import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("external storage container build readiness evidence", () => {
  it("prints redacted dry-run readiness for the external storage container artifact", () => {
    const output = execFileSync("node", [
      "scripts/external-storage-container-build-readiness.mjs",
      "--dry-run",
      "--image-tag",
      "registry.example.test/uais/external-storage:secret-build-tag",
      "--release-run-id",
      "enterprise-current-20260627",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        target: "external-storage-container-build-readiness",
        mode: "dry-run",
        releaseRunId: "enterprise-current-20260627",
        dockerfile: {
          path: "Dockerfile.external-storage",
          status: "present",
          contract: "passed",
        },
        dockerignore: {
          path: ".dockerignore",
          status: "present",
          secretExclusion: "passed",
          generatedOutputExclusion: "passed",
        },
        buildCommand:
          "docker build -f Dockerfile.external-storage -t <image-tag> .",
        image: {
          tagStatus: "present",
          valueRedacted: true,
        },
        docker: {
          client: "not-checked",
          daemon: "not-checked",
          outputRedacted: true,
        },
        safety: {
          imageTagOmitted: true,
          dockerOutputOmitted: true,
          localPrivatePathsOmitted: true,
          secretsExcludedFromContext: true,
          buildNotRunInDryRun: true,
          buildRunInApprovedMode: false,
          dockerProbeRun: false,
        },
      }),
    );
    expect(output).not.toContain("registry.example.test");
    expect(output).not.toContain("secret-build-tag");
    expect(output).not.toContain("/Users/");
  });

  it("does not invoke Docker during the default offline dry-run", () => {
    const fakeBinDir = mkdtempSync(join(tmpdir(), "uais-fake-docker-offline-dry-run-"));
    const fakeDocker = join(fakeBinDir, "docker");
    const invocationLog = join(fakeBinDir, "docker-invocations.log");
    writeFileSync(
      fakeDocker,
      [
        "#!/bin/sh",
        `echo "$@" >> "${invocationLog}"`,
        "exit 1",
        "",
      ].join("\n"),
    );
    chmodSync(fakeDocker, 0o755);

    const output = execFileSync("node", [
      "scripts/external-storage-container-build-readiness.mjs",
      "--dry-run",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
      },
    });

    expect(JSON.parse(output).docker).toEqual({
      client: "not-checked",
      daemon: "not-checked",
      outputRedacted: true,
    });
    expect(existsSync(invocationLog)).toBe(false);
  });

  it("blocks when the docker artifact files are missing without leaking local paths", () => {
    const missingDir = mkdtempSync(join(tmpdir(), "uais-missing-container-artifact-"));
    const output = execFileSync("node", [
      "scripts/external-storage-container-build-readiness.mjs",
      "--dry-run",
      "--dockerfile",
      join(missingDir, "missing.Dockerfile"),
      "--dockerignore",
      join(missingDir, "missing.dockerignore"),
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        status: "blocked",
        dockerfile: expect.objectContaining({
          path: "redacted",
          status: "missing",
        }),
        dockerignore: expect.objectContaining({
          path: "redacted",
          status: "missing",
        }),
        blockedReasons: expect.arrayContaining([
          "external-storage-dockerfile-missing",
          "external-storage-dockerignore-missing",
        ]),
      }),
    );
    expect(output).not.toContain(missingDir);
    expect(output).not.toContain("/Users/");
  });

  it("distinguishes a present docker client from an unavailable daemon", () => {
    const fakeBinDir = mkdtempSync(join(tmpdir(), "uais-fake-docker-"));
    const fakeDocker = join(fakeBinDir, "docker");
    writeFileSync(
      fakeDocker,
      [
        "#!/bin/sh",
        "if [ \"$1\" = \"--version\" ]; then",
        "  echo 'Docker version 29.5.2, build fixture'",
        "  exit 0",
        "fi",
        "echo 'daemon unavailable at /private/docker.sock' >&2",
        "exit 1",
        "",
      ].join("\n"),
    );
    chmodSync(fakeDocker, 0o755);

    const output = execFileSync("node", [
      "scripts/external-storage-container-build-readiness.mjs",
      "--dry-run",
      "--probe-docker",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
      },
    });
    const body = JSON.parse(output);

    expect(body).toEqual(
      expect.objectContaining({
        status: "blocked",
        docker: {
          client: "present",
          daemon: "unavailable",
          outputRedacted: true,
        },
        blockedReasons: expect.arrayContaining(["docker-daemon-unavailable"]),
      }),
    );
    expect(output).not.toContain(fakeBinDir);
    expect(output).not.toContain("/private/docker.sock");
    expect(output).not.toContain("/Users/");
  });

  it("bounds a stalled docker daemon probe in dry-run mode", () => {
    const fakeBinDir = mkdtempSync(join(tmpdir(), "uais-fake-docker-stalled-daemon-"));
    const fakeDocker = join(fakeBinDir, "docker");
    writeFileSync(
      fakeDocker,
      [
        "#!/bin/sh",
        "if [ \"$1\" = \"--version\" ]; then",
        "  echo 'Docker version 29.5.2, build fixture'",
        "  exit 0",
        "fi",
        "sleep 10",
        "exit 1",
        "",
      ].join("\n"),
    );
    chmodSync(fakeDocker, 0o755);

    const startedAt = Date.now();
    const output = execFileSync("node", [
      "scripts/external-storage-container-build-readiness.mjs",
      "--dry-run",
      "--probe-docker",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 12_000,
      env: {
        ...process.env,
        PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
      },
    });
    const durationMs = Date.now() - startedAt;
    const body = JSON.parse(output);

    expect(durationMs).toBeLessThan(10_000);
    expect(body.docker).toEqual({
      client: "present",
      daemon: "unavailable",
      outputRedacted: true,
    });
    expect(output).not.toContain(fakeBinDir);
    expect(output).not.toContain("/Users/");
  });

  it("preserves approved build-mode evidence when the docker daemon is unavailable", () => {
    const fakeBinDir = mkdtempSync(join(tmpdir(), "uais-fake-docker-approved-daemon-"));
    const fakeDocker = join(fakeBinDir, "docker");
    const invocationLog = join(fakeBinDir, "docker-invocations.log");
    writeFileSync(
      fakeDocker,
      [
        "#!/bin/sh",
        `echo "$@" >> "${invocationLog}"`,
        "if [ \"$1\" = \"--version\" ]; then",
        "  echo 'Docker version 29.5.2, build fixture'",
        "  exit 0",
        "fi",
        "if [ \"$1\" = \"version\" ]; then",
        "  echo 'daemon unavailable at /private/docker.sock' >&2",
        "  exit 1",
        "fi",
        "if [ \"$1\" = \"build\" ]; then",
        "  echo 'build must not run while daemon is unavailable' >&2",
        "  exit 1",
        "fi",
        "exit 1",
        "",
      ].join("\n"),
    );
    chmodSync(fakeDocker, 0o755);

    const output = execFileSync("node", [
      "scripts/external-storage-container-build-readiness.mjs",
      "--build",
      "--approved",
      "--image-tag",
      "registry.example.test/uais/external-storage:secret-build-tag",
      "--release-run-id",
      "enterprise-current-20260628",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
      },
    });
    const body = JSON.parse(output);
    const invocations = readFileSync(invocationLog, "utf8");

    expect(body).toEqual(
      expect.objectContaining({
        mode: "build",
        status: "blocked",
        docker: {
          client: "present",
          daemon: "unavailable",
          outputRedacted: true,
        },
        build: {
          status: "not-run",
          invoked: false,
          outputRedacted: true,
        },
        blockedReasons: ["docker-daemon-unavailable"],
        safety: expect.objectContaining({
          buildNotRunInDryRun: false,
          buildRunInApprovedMode: true,
        }),
      }),
    );
    expect(invocations).not.toContain("build -f Dockerfile.external-storage");
    expect(output).not.toContain("registry.example.test");
    expect(output).not.toContain("secret-build-tag");
    expect(output).not.toContain(fakeBinDir);
    expect(output).not.toContain("/private/docker.sock");
    expect(output).not.toContain("/Users/");
  });

  it("runs a redacted approved container build through docker when build mode is selected", () => {
    const fakeBinDir = mkdtempSync(join(tmpdir(), "uais-fake-docker-build-"));
    const fakeDocker = join(fakeBinDir, "docker");
    const invocationLog = join(fakeBinDir, "docker-invocations.log");
    writeFileSync(
      fakeDocker,
      [
        "#!/bin/sh",
        `echo "$@" >> "${invocationLog}"`,
        "if [ \"$1\" = \"--version\" ]; then",
        "  echo 'Docker version 29.5.2, build fixture'",
        "  exit 0",
        "fi",
        "if [ \"$1\" = \"version\" ]; then",
        "  echo '29.5.2'",
        "  exit 0",
        "fi",
        "if [ \"$1\" = \"build\" ]; then",
        "  echo 'built image containing secret-build-tag and /Users/private/context'",
        "  exit 0",
        "fi",
        "exit 1",
        "",
      ].join("\n"),
    );
    chmodSync(fakeDocker, 0o755);

    const output = execFileSync("node", [
      "scripts/external-storage-container-build-readiness.mjs",
      "--build",
      "--approved",
      "--image-tag",
      "registry.example.test/uais/external-storage:secret-build-tag",
      "--release-run-id",
      "enterprise-current-20260627",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
      },
    });
    const body = JSON.parse(output);
    const invocations = readFileSync(invocationLog, "utf8");

    expect(body).toEqual(
      expect.objectContaining({
        target: "external-storage-container-build-readiness",
        mode: "build",
        releaseRunId: "enterprise-current-20260627",
        status: "ready",
        build: {
          status: "passed",
          invoked: true,
          outputRedacted: true,
        },
        safety: expect.objectContaining({
          imageTagOmitted: true,
          dockerOutputOmitted: true,
          buildRunInApprovedMode: true,
        }),
      }),
    );
    expect(invocations).toContain("build -f Dockerfile.external-storage -t registry.example.test/uais/external-storage:secret-build-tag .");
    expect(output).not.toContain("registry.example.test");
    expect(output).not.toContain("secret-build-tag");
    expect(output).not.toContain("/Users/private/context");
    expect(output).not.toContain(fakeBinDir);
  });

  it("blocks container build mode without explicit approval before invoking docker build", () => {
    const fakeBinDir = mkdtempSync(join(tmpdir(), "uais-fake-docker-unapproved-build-"));
    const fakeDocker = join(fakeBinDir, "docker");
    const invocationLog = join(fakeBinDir, "docker-invocations.log");
    writeFileSync(
      fakeDocker,
      [
        "#!/bin/sh",
        `echo "$@" >> "${invocationLog}"`,
        "if [ \"$1\" = \"--version\" ]; then",
        "  echo 'Docker version 29.5.2, build fixture'",
        "  exit 0",
        "fi",
        "if [ \"$1\" = \"version\" ]; then",
        "  echo '29.5.2'",
        "  exit 0",
        "fi",
        "if [ \"$1\" = \"build\" ]; then",
        "  echo 'build must not run' >&2",
        "  exit 1",
        "fi",
        "exit 0",
        "",
      ].join("\n"),
    );
    chmodSync(fakeDocker, 0o755);

    const output = execFileSync("node", [
      "scripts/external-storage-container-build-readiness.mjs",
      "--build",
      "--image-tag",
      "registry.example.test/uais/external-storage:secret-build-tag",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
      },
    });
    const body = JSON.parse(output);
    const invocations = readFileSync(invocationLog, "utf8");

    expect(body).toEqual(
      expect.objectContaining({
        mode: "build",
        status: "blocked",
        build: expect.objectContaining({
          status: "not-run",
          invoked: false,
          outputRedacted: true,
        }),
        blockedReasons: expect.arrayContaining([
          "external-storage-container-build-approval-missing",
        ]),
      }),
    );
    expect(invocations).not.toContain("build -f Dockerfile.external-storage");
    expect(output).not.toContain("registry.example.test");
    expect(output).not.toContain("secret-build-tag");
    expect(output).not.toContain(fakeBinDir);
  });
});
