#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

try {
  const options = parseArgs(process.argv.slice(2));
  const avfoundationText = options.avfoundationDevicesText
    ? readFileSync(options.avfoundationDevicesText, "utf8")
    : collectAvfoundationDevicesText();
  const systemAudioText = options.systemAudioText
    ? readFileSync(options.systemAudioText, "utf8")
    : collectSystemAudioText();
  const halPluginListText = options.halPluginListText
    ? readFileSync(options.halPluginListText, "utf8")
    : options.avfoundationDevicesText || options.systemAudioText
      ? ""
      : collectHalPluginListText();
  const avfoundationAudioDevices = parseAvfoundationAudioDevices(avfoundationText);
  const systemAudioDevices = parseSystemAudioDevices(systemAudioText);
  const loopbackInstallFindings = detectLoopbackInstallFindings(halPluginListText);
  const loopbackInstallStatus =
    loopbackInstallFindings.length > 0 ? "malformed-install-detected" : "not-detected";
  const loopbackCaptureDevices = avfoundationAudioDevices.filter(
    (device) => device.category === "dedicated-loopback",
  );
  const loopbackCaptureStatus = loopbackCaptureDevices.length > 0 ? "available" : "missing";
  const blockedReasons =
    loopbackCaptureStatus === "available"
      ? ["human-auditory-playback-record-still-required"]
      : [
          "system-output-loopback-capture-not-available",
          ...(loopbackInstallStatus === "malformed-install-detected"
            ? ["malformed-loopback-driver-install-detected"]
            : []),
          "microphone-capture-not-accepted-for-manual-playback",
          "human-auditory-playback-record-still-required",
        ];
  const report = {
    target: "ppt-auditory-capture-readiness",
    checkedAt: new Date().toISOString(),
    status:
      loopbackCaptureStatus === "available"
        ? "ready-for-audio-capture-smoke"
        : "blocked",
    loopbackCaptureStatus,
    loopbackInstallStatus,
    manualAcceptanceStatus: "not-accepted",
    avfoundationAudioDevices,
    systemAudioDevices,
    loopbackInstallFindings,
    loopbackCaptureDevices,
    blockedReasons,
    ...(loopbackInstallStatus === "malformed-install-detected"
      ? {
          remediation: {
            requiresOwnerOrSystemAdminAction: true,
            systemSettingsChangedByThisScript: false,
            summary:
              "A BlackHole-like HAL bundle is present in an abnormal layout but is not exposed as an AVFoundation audio input. Repair should be done as an explicit system-admin action, then the Mac should be rebooted or CoreAudio restarted before rerunning this readiness check.",
          },
        }
      : {}),
    note:
      loopbackCaptureStatus === "available"
        ? "A dedicated loopback device is visible for a future application-audio capture smoke, but it is still not a human auditory playback acceptance record."
        : "No dedicated system-output loopback capture device is visible. Microphone or meeting virtual audio capture is intentionally not accepted as final manual playback evidence.",
    safety: {
      rawAudioCaptured: false,
      rawAudioOmitted: true,
      microphoneCaptureAvoided: true,
      systemSettingsChanged: false,
      manualAcceptanceNotFaked: true,
    },
  };
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (options.out) {
    writeFileSync(options.out, output);
  }
  process.stdout.write(output);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Audio readiness failed."}\n`);
  process.exitCode = 1;
}

function parseArgs(args) {
  const options = {
    avfoundationDevicesText: undefined,
    systemAudioText: undefined,
    halPluginListText: undefined,
    out: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--avfoundation-devices-text") {
      options.avfoundationDevicesText = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--system-audio-text") {
      options.systemAudioText = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--hal-plugin-list-text") {
      options.halPluginListText = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--out") {
      options.out = readArgValue(args, index, arg);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: node scripts/ppt-audio-capture-readiness.mjs [--avfoundation-devices-text PATH] [--system-audio-text PATH] [--out PATH]",
          "",
          "Creates a redacted readiness report for automated system-audio capture. This never counts as final human PowerPoint/WPS playback acceptance.",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error("Unknown option.");
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

function collectAvfoundationDevicesText() {
  try {
    return execFileSync(
      "ffmpeg",
      ["-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch (error) {
    const stderr = typeof error?.stderr === "string" ? error.stderr : "";
    const stdout = typeof error?.stdout === "string" ? error.stdout : "";
    return `${stdout}\n${stderr}`;
  }
}

function collectSystemAudioText() {
  try {
    return execFileSync("system_profiler", ["SPAudioDataType"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return "";
  }
}

function collectHalPluginListText() {
  try {
    return execFileSync("find", ["/Library/Audio/Plug-Ins/HAL", "-maxdepth", "4", "-print"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return "";
  }
}

function parseAvfoundationAudioDevices(text) {
  const devices = [];
  let inAudioSection = false;
  for (const line of text.split(/\r?\n/)) {
    if (line.includes("AVFoundation audio devices:")) {
      inAudioSection = true;
      continue;
    }
    if (line.includes("AVFoundation video devices:")) {
      inAudioSection = false;
      continue;
    }
    if (!inAudioSection) {
      continue;
    }
    const match = line.match(/\[(\d+)\]\s+(.+?)\s*$/);
    if (!match) {
      continue;
    }
    const name = match[2].trim();
    devices.push({
      index: Number.parseInt(match[1], 10),
      name,
      category: categorizeAudioDevice(name),
    });
  }
  return devices;
}

function parseSystemAudioDevices(text) {
  const devices = [];
  let current;
  for (const line of text.split(/\r?\n/)) {
    const deviceMatch = line.match(/^\s{8}([^:]+):\s*$/);
    if (deviceMatch) {
      if (current) {
        devices.push(finalizeSystemAudioDevice(current));
      }
      current = {
        name: deviceMatch[1].trim(),
        hasInput: false,
        hasOutput: false,
      };
      continue;
    }
    if (!current) {
      continue;
    }
    if (/Input Channels:\s*[1-9]\d*/.test(line)) {
      current.hasInput = true;
    }
    if (/Output Channels:\s*[1-9]\d*/.test(line)) {
      current.hasOutput = true;
    }
  }
  if (current) {
    devices.push(finalizeSystemAudioDevice(current));
  }
  return devices;
}

function finalizeSystemAudioDevice(device) {
  return {
    name: device.name,
    direction:
      device.hasInput && device.hasOutput
        ? "input-output"
        : device.hasInput
          ? "input"
          : device.hasOutput
            ? "output"
            : "unknown",
    category: categorizeAudioDevice(device.name),
  };
}

function detectLoopbackInstallFindings(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const hasRootContents = lines.some((line) => /\/HAL\/Contents$/.test(line));
  const hasBlackHoleRootPlist = lines.some((line) => /\/HAL\/Contents\/Info\.plist$/.test(line));
  const hasBlackHoleTxtExecutable = lines.some(
    (line) => /\/HAL\/Contents\/MacOS\/BlackHole\.txt$/.test(line),
  );
  const hasProperBlackHoleBundle = lines.some(
    (line) => /\/HAL\/BlackHole[^/]*\.driver\/Contents$/i.test(line),
  );
  const findings = [];
  if ((hasRootContents || hasBlackHoleRootPlist) && !hasProperBlackHoleBundle) {
    findings.push("blackhole-hal-contents-at-plugin-root");
  }
  if (hasBlackHoleTxtExecutable) {
    findings.push("blackhole-executable-has-txt-extension");
  }
  return findings;
}

function categorizeAudioDevice(name) {
  if (/(blackhole|loopback|soundflower|vb-cable|virtual audio cable)/i.test(name)) {
    return "dedicated-loopback";
  }
  if (/(wemeet|tencent|zoom|teams|meeting)/i.test(name)) {
    return "meeting-virtual-audio";
  }
  if (/(speaker|hdmi|display|monitor)/i.test(name)) {
    return "speaker-output";
  }
  if (/(microphone|camera-audio|camera|input)/i.test(name)) {
    return "microphone";
  }
  return "unknown";
}
