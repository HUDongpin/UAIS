import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("PPT auditory capture readiness", () => {
  it("blocks automated auditory playback acceptance when only microphone or meeting audio devices are available", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ppt-audio-capture-readiness-"));
    const avfoundationDevices = join(tmpDir, "avfoundation.txt");
    const systemAudio = join(tmpDir, "system-audio.txt");
    const out = join(tmpDir, "readiness.json");

    writeFileSync(
      avfoundationDevices,
      [
        "[AVFoundation indev @ 0x1] AVFoundation audio devices:",
        "[AVFoundation indev @ 0x1] [0] HIK 2K Camera-Audio",
        "[AVFoundation indev @ 0x1] [1] WeMeet Audio Device",
      ].join("\n"),
    );
    writeFileSync(
      systemAudio,
      [
        "Audio:",
        "",
        "    Devices:",
        "",
        "        Mac mini Speakers:",
        "          Default Output Device: Yes",
        "          Output Channels: 2",
        "",
        "        HIK 2K Camera-Audio:",
        "          Default Input Device: Yes",
        "          Input Channels: 1",
        "",
        "        WeMeet Audio Device:",
        "          Input Channels: 2",
        "          Output Channels: 2",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/ppt-audio-capture-readiness.mjs",
      "--avfoundation-devices-text",
      avfoundationDevices,
      "--system-audio-text",
      systemAudio,
      "--out",
      out,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);
    const written = JSON.parse(readFileSync(out, "utf8"));

    expect(body).toEqual(
      expect.objectContaining({
        target: "ppt-auditory-capture-readiness",
        status: "blocked",
        manualAcceptanceStatus: "not-accepted",
        loopbackCaptureStatus: "missing",
        blockedReasons: [
          "system-output-loopback-capture-not-available",
          "microphone-capture-not-accepted-for-manual-playback",
          "human-auditory-playback-record-still-required",
        ],
        safety: {
          rawAudioCaptured: false,
          rawAudioOmitted: true,
          microphoneCaptureAvoided: true,
          systemSettingsChanged: false,
          manualAcceptanceNotFaked: true,
        },
      }),
    );
    expect(body.avfoundationAudioDevices).toEqual([
      { index: 0, name: "HIK 2K Camera-Audio", category: "microphone" },
      { index: 1, name: "WeMeet Audio Device", category: "meeting-virtual-audio" },
    ]);
    expect(body.systemAudioDevices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Mac mini Speakers", direction: "output" }),
        expect.objectContaining({ name: "HIK 2K Camera-Audio", direction: "input" }),
        expect.objectContaining({ name: "WeMeet Audio Device", direction: "input-output" }),
      ]),
    );
    expect(written).toEqual(body);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("recognizes a dedicated loopback device as capture-smoke ready without converting it into human acceptance", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ppt-audio-capture-loopback-"));
    const avfoundationDevices = join(tmpDir, "avfoundation.txt");
    const systemAudio = join(tmpDir, "system-audio.txt");

    writeFileSync(
      avfoundationDevices,
      [
        "[AVFoundation indev @ 0x1] AVFoundation audio devices:",
        "[AVFoundation indev @ 0x1] [0] HIK 2K Camera-Audio",
        "[AVFoundation indev @ 0x1] [1] BlackHole 2ch",
      ].join("\n"),
    );
    writeFileSync(
      systemAudio,
      [
        "Audio:",
        "",
        "    Devices:",
        "",
        "        BlackHole 2ch:",
        "          Input Channels: 2",
        "          Output Channels: 2",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/ppt-audio-capture-readiness.mjs",
      "--avfoundation-devices-text",
      avfoundationDevices,
      "--system-audio-text",
      systemAudio,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("ready-for-audio-capture-smoke");
    expect(body.loopbackCaptureStatus).toBe("available");
    expect(body.loopbackCaptureDevices).toEqual([
      { index: 1, name: "BlackHole 2ch", category: "dedicated-loopback" },
    ]);
    expect(body.manualAcceptanceStatus).toBe("not-accepted");
    expect(body.blockedReasons).toEqual(["human-auditory-playback-record-still-required"]);
    expect(body.safety.manualAcceptanceNotFaked).toBe(true);
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });

  it("detects a malformed BlackHole HAL bundle without changing system audio settings", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uais-ppt-audio-capture-hal-"));
    const avfoundationDevices = join(tmpDir, "avfoundation.txt");
    const systemAudio = join(tmpDir, "system-audio.txt");
    const halPluginList = join(tmpDir, "hal-plugin-list.txt");

    writeFileSync(
      avfoundationDevices,
      [
        "[AVFoundation indev @ 0x1] AVFoundation audio devices:",
        "[AVFoundation indev @ 0x1] [0] HIK 2K Camera-Audio",
      ].join("\n"),
    );
    writeFileSync(
      systemAudio,
      [
        "Audio:",
        "",
        "    Devices:",
        "",
        "        HIK 2K Camera-Audio:",
        "          Input Channels: 1",
      ].join("\n"),
    );
    writeFileSync(
      halPluginList,
      [
        "/Library/Audio/Plug-Ins/HAL",
        "/Library/Audio/Plug-Ins/HAL/Contents",
        "/Library/Audio/Plug-Ins/HAL/Contents/Info.plist",
        "/Library/Audio/Plug-Ins/HAL/Contents/MacOS",
        "/Library/Audio/Plug-Ins/HAL/Contents/MacOS/BlackHole.txt",
        "/Library/Audio/Plug-Ins/HAL/ToDeskOutputDriver.driver",
        "/Library/Audio/Plug-Ins/HAL/ToDeskOutputDriver.driver/Contents",
      ].join("\n"),
    );

    const output = execFileSync("node", [
      "scripts/ppt-audio-capture-readiness.mjs",
      "--avfoundation-devices-text",
      avfoundationDevices,
      "--system-audio-text",
      systemAudio,
      "--hal-plugin-list-text",
      halPluginList,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const body = JSON.parse(output);

    expect(body.status).toBe("blocked");
    expect(body.loopbackCaptureStatus).toBe("missing");
    expect(body.loopbackInstallStatus).toBe("malformed-install-detected");
    expect(body.loopbackInstallFindings).toEqual([
      "blackhole-hal-contents-at-plugin-root",
      "blackhole-executable-has-txt-extension",
    ]);
    expect(body.blockedReasons).toEqual([
      "system-output-loopback-capture-not-available",
      "malformed-loopback-driver-install-detected",
      "microphone-capture-not-accepted-for-manual-playback",
      "human-auditory-playback-record-still-required",
    ]);
    expect(body.remediation).toEqual(
      expect.objectContaining({
        requiresOwnerOrSystemAdminAction: true,
        systemSettingsChangedByThisScript: false,
      }),
    );
    expect(output).not.toContain(tmpDir);
    expect(output).not.toContain("/Users/");
  });
});
