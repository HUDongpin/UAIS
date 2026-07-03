import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const requiredPacketFields = [
  "preferredInputMode",
  "safeInputInstruction",
  "approvedSourceLabelIsNotEvidence",
];

const packetReaderFunctionPattern =
  /function (readSafeOperatorInputPacket|readOperatorInputPacket|sanitizeOperatorInputPacket)\b/g;

describe("operator input packet safety propagation", () => {
  it("preserves safe source-handle guidance in every packet reader", () => {
    const scriptsDir = join(process.cwd(), "scripts");
    const scriptNames = readdirSync(scriptsDir).filter((name) => name.endsWith(".mjs"));
    const checkedReaders = [];

    for (const scriptName of scriptNames) {
      const source = readFileSync(join(scriptsDir, scriptName), "utf8");

      for (const match of source.matchAll(packetReaderFunctionPattern)) {
        const functionName = match[1];
        const functionSource = source.slice(match.index, match.index + 1_200);

        checkedReaders.push(`${scriptName}:${functionName}`);

        for (const field of requiredPacketFields) {
          expect(
            functionSource,
            `${scriptName}:${functionName} must preserve operator packet field ${field}`,
          ).toContain(field);
        }
      }
    }

    expect(checkedReaders.length).toBeGreaterThan(0);
  });
});
