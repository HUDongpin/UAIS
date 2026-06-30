import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("external storage service container artifact", () => {
  it("defines a minimal production container that runs the redacted launcher", () => {
    const dockerfile = readFileSync("Dockerfile.external-storage", "utf8");

    expect(dockerfile).toContain("FROM node:24-alpine");
    expect(dockerfile).toContain("WORKDIR /app");
    expect(dockerfile).toContain(
      "COPY scripts/external-storage-service.mjs scripts/external-storage-service-production-launcher.mjs ./scripts/",
    );
    expect(dockerfile).toContain("ENV NODE_ENV=production");
    expect(dockerfile).toContain("ENV UAIS_EXTERNAL_STORAGE_HOST=0.0.0.0");
    expect(dockerfile).toContain(
      "ENV UAIS_EXTERNAL_STORAGE_DATA_DIR=/data/uais-external-storage",
    );
    expect(dockerfile).toContain('VOLUME ["/data/uais-external-storage"]');
    expect(dockerfile).toContain("EXPOSE 8787");
    expect(dockerfile).toContain(
      'CMD ["node", "scripts/external-storage-service-production-launcher.mjs", "--live"]',
    );
    expect(dockerfile).not.toContain("UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN=");
    expect(dockerfile).not.toContain(".env");
    expect(dockerfile).not.toContain("All API Keys");
  });

  it("keeps secrets, generated outputs, and local evidence out of the docker context", () => {
    const dockerignore = readFileSync(".dockerignore", "utf8");

    expect(dockerignore).toContain(".env*");
    expect(dockerignore).toContain("All API Keys.docx");
    expect(dockerignore).toContain("node_modules");
    expect(dockerignore).toContain(".next");
    expect(dockerignore).toContain("coordination/reports");
    expect(dockerignore).toContain("output");
    expect(dockerignore).toContain("OpenMAIC-main.zip");
    expect(dockerignore).toContain("*.pem");
  });
});
