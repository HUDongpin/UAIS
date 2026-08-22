import { describe, expect, it } from "vitest";
import { normalizePublishedDeck } from "@/lib/learning/published-deck-validation.mjs";

function createDeck() {
  return {
    courseId: "course-1",
    courseTitle: "课程一",
    sourceDeckTitle: "第一讲",
    teacherName: "教师",
    voiceLabel: "讲解音频",
    audioManifestId: "manifest-1",
    pptAssetId: "ppt-1",
    slides: [
      {
        slideId: "slide-01",
        slideTitle: "第一页",
        narrationText: "讲解",
        audioId: "ppt-1-slide-01",
        durationSeconds: 12,
      },
    ],
  };
}

describe("published learning unit identity", () => {
  it("accepts an explicit bilingual learning unit on new manifests", () => {
    expect(
      normalizePublishedDeck({
        ...createDeck(),
        learningUnit: {
          lessonKey: "natural-numbers-01",
          position: 1,
          title: { "zh-CN": "自然数", "en-US": "Natural numbers" },
        },
      }).learningUnit,
    ).toEqual({
      lessonKey: "natural-numbers-01",
      position: 1,
      title: { "zh-CN": "自然数", "en-US": "Natural numbers" },
    });
  });

  it("keeps old decks compatible by using audioManifestId as a read-only lesson key", () => {
    const deck = normalizePublishedDeck(createDeck());

    expect(deck.learningUnit).toBeUndefined();
    expect(deck.audioManifestId).toBe("manifest-1");
  });

  it("rejects incomplete bilingual unit identity or non-positive position", () => {
    expect(() =>
      normalizePublishedDeck({
        ...createDeck(),
        learningUnit: {
          lessonKey: "natural-numbers-01",
          position: 0,
          title: { "zh-CN": "自然数", "en-US": "" },
        },
      }),
    ).toThrowError(/learningUnit/);
  });
});
