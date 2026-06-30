#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const crop = {
  width: 766,
  height: 332,
  offsetY: 284,
  offsetX: 42,
};

const defaults = {
  url: "http://localhost:3107/login",
  pageScreenshot: "output/playwright/uais-login-visual-page.png",
  crop: "output/playwright/uais-login-visual-deck-766x332.png",
  diff: "output/playwright/uais-login-visual-diff.png",
  mode: "html-overlay",
  viewport: "1440,900",
  wait: "1200",
};

try {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    process.stdout.write(
      [
        "Usage: node scripts/login-visual-regression.mjs [options]",
        "",
        "Captures the UAIS /login left visual deck, crops it to 766x332, and optionally compares it with a reference image.",
        "",
        "Options:",
        "  --url URL                 Login URL to capture. Default: http://localhost:3107/login",
        "  --reference PATH          Optional approved 766x332 reference image.",
        "  --current PATH            Optional existing 766x332 current crop; skips browser capture.",
        "  --mode html-overlay|baked Comparison threshold profile. Default: html-overlay",
        "  --max-diff RATIO          Override allowed diff ratio. Default: 0.03 for html-overlay, 0.01 for baked",
        "  --page PATH               Full-page screenshot output path.",
        "  --crop PATH               766x332 crop output path.",
        "  --diff PATH               Pixelmatch diff output path.",
        "  --dry-run                 Print the evidence plan without running browser or image commands.",
        "",
        "The default crop is 766x332 at crop offset y=284, x=42 for a 1440x900 Playwright screenshot.",
      ].join("\n"),
    );
    process.exit(0);
  }

  const mode = options.mode ?? defaults.mode;
  const maxDiffRatio =
    options.maxDiffRatio ?? (mode === "baked" ? 0.01 : 0.03);
  const evidence = buildEvidence({
    ...options,
    mode,
    maxDiffRatio,
  });

  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    process.exit(0);
  }

  if ((options.reference && !existsSync(options.reference)) || (options.current && !existsSync(options.current))) {
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    process.exit(0);
  }

  mkdirSync(dirname(evidence.outputs.pageScreenshot), { recursive: true });
  mkdirSync(dirname(evidence.outputs.crop), { recursive: true });
  mkdirSync(dirname(evidence.outputs.diff ?? defaults.diff), { recursive: true });

  if (!options.current) {
    runCommand("npx", [
      "playwright",
      "screenshot",
      `--viewport-size=${defaults.viewport}`,
      `--wait-for-timeout=${defaults.wait}`,
      "--full-page",
      options.url ?? defaults.url,
      evidence.outputs.pageScreenshot,
    ]);

    runCommand("sips", [
      "-c",
      String(crop.height),
      String(crop.width),
      "--cropOffset",
      String(crop.offsetY),
      String(crop.offsetX),
      evidence.outputs.pageScreenshot,
      "--out",
      evidence.outputs.crop,
    ]);
  }

  const cropSize = readImageSize(evidence.outputs.crop);
  if (cropSize.width !== crop.width || cropSize.height !== crop.height) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ...evidence,
          status: "blocked",
          evidenceStatus: "crop-size-mismatch",
          blockedReasons: ["login-crop-size-mismatch"],
          actualCrop: cropSize,
        },
        null,
        2,
      )}\n`,
    );
    process.exit(0);
  }

  if (!options.reference) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ...evidence,
          generated: {
            pageScreenshot: !options.current,
            crop: !options.current,
            diff: false,
          },
        },
        null,
        2,
      )}\n`,
    );
    process.exit(0);
  }

  const referenceSize = readImageSize(options.reference);
  if (referenceSize.width !== crop.width || referenceSize.height !== crop.height) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ...evidence,
          status: "blocked",
          evidenceStatus: "reference-size-mismatch",
          blockedReasons: ["login-reference-size-mismatch"],
          actualReference: referenceSize,
        },
        null,
        2,
      )}\n`,
    );
    process.exit(0);
  }

  const diffPixels = runImageCompare({
    reference: options.reference,
    current: evidence.outputs.crop,
    diff: evidence.outputs.diff,
  });
  const diffRatio = diffPixels / (crop.width * crop.height);
  const diffPercent = diffRatio * 100;
  const accepted = diffRatio <= maxDiffRatio;

  process.stdout.write(
    `${JSON.stringify(
      {
        ...evidence,
        status: accepted ? "accepted" : "blocked",
        evidenceStatus: accepted ? "visual-diff-passed" : "visual-diff-failed",
        diffRatio,
        diffPercent,
        blockedReasons: accepted ? [] : ["login-visual-diff-above-threshold"],
        generated: {
          pageScreenshot: !options.current,
          crop: !options.current,
          diff: true,
        },
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Login visual regression failed."}\n`,
  );
  process.exitCode = 1;
}

function buildEvidence(options) {
  const referenceMissing = options.reference ? !existsSync(options.reference) : false;
  const currentMissing = options.current ? !existsSync(options.current) : false;
  return {
    target: "login-visual-regression",
    status: referenceMissing || currentMissing ? "blocked" : options.reference ? "pending" : "evidence-only",
    evidenceStatus: referenceMissing
      ? "reference-missing"
      : currentMissing
        ? "current-crop-missing"
      : options.reference
        ? "reference-ready"
        : "current-baseline",
    responsibleSession: "S01",
    mode: options.mode,
    maxDiffRatio: options.maxDiffRatio,
    url: options.url ?? defaults.url,
    crop,
    outputs: {
      pageScreenshot: options.pageScreenshot ?? defaults.pageScreenshot,
      crop: options.current ?? options.cropOutput ?? defaults.crop,
      diff: options.reference ? options.diff ?? defaults.diff : null,
    },
    reference: options.reference
      ? {
          provided: true,
          exists: !referenceMissing,
        }
      : {
          provided: false,
          exists: false,
        },
    blockedReasons: [
      ...(referenceMissing ? ["login-reference-image-missing"] : []),
      ...(currentMissing ? ["login-current-crop-missing"] : []),
    ],
    safety: {
      commandOutputOmitted: true,
      secretsRedacted: true,
      localPrivatePathsOmitted: true,
    },
  };
}

function parseArgs(args) {
  const options = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--url") {
      options.url = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--reference") {
      options.reference = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--current") {
      options.current = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--mode") {
      options.mode = readArgValue(args, index, arg);
      if (!["html-overlay", "baked"].includes(options.mode)) {
        throw new Error("--mode must be html-overlay or baked.");
      }
      index += 1;
    } else if (arg === "--max-diff") {
      const value = Number(readArgValue(args, index, arg));
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error("--max-diff must be a ratio between 0 and 1.");
      }
      options.maxDiffRatio = value;
      index += 1;
    } else if (arg === "--page") {
      options.pageScreenshot = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--crop") {
      options.cropOutput = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--diff") {
      options.diff = readArgValue(args, index, arg);
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function readArgValue(args, index, name) {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed while producing login visual evidence.`);
  }
  return result;
}

function runImageCompare(input) {
  const args = [
    "compare",
    "-metric",
    "AE",
    input.reference,
    input.current,
    input.diff,
  ];
  const result = spawnSync("magick", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const fallbackResult =
    result.error?.code === "ENOENT"
      ? spawnSync("compare", args.slice(1), {
          cwd: process.cwd(),
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        })
      : result;

  if (fallbackResult.status !== 0 && fallbackResult.status !== 1) {
    throw new Error("ImageMagick compare failed while producing login visual evidence.");
  }
  const diffPixels = Number(
    `${fallbackResult.stderr}\n${fallbackResult.stdout}`.match(/[\d.]+/)?.[0] ?? "0",
  );
  if (!Number.isFinite(diffPixels)) {
    throw new Error("Unable to parse ImageMagick visual diff.");
  }
  return diffPixels;
}

function readImageSize(path) {
  const result = runCommand("sips", ["-g", "pixelWidth", "-g", "pixelHeight", path]);
  const width = Number(result.stdout.match(/pixelWidth:\s*(\d+)/)?.[1]);
  const height = Number(result.stdout.match(/pixelHeight:\s*(\d+)/)?.[1]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error("Unable to read image dimensions.");
  }
  return { width, height };
}
