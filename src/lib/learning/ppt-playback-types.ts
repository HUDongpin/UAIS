export type LearningPptPlaybackSlide = {
  slideId: string;
  slideNumber: number;
  slideTitle: string;
  narrationText: string;
  imageUrl: string;
  audioId: string;
  audioUrl: string;
  durationSeconds: number;
};

export type LearningPptPlaybackManifest = {
  status: "ready";
  courseId: string;
  courseTitle: string;
  sourceDeckTitle: string;
  audioManifestId: string;
  teacherName: string;
  voiceLabel: string;
  slideCount: number;
  slides: LearningPptPlaybackSlide[];
  redaction: {
    secrets: "omitted";
    localFiles: "omitted";
    assets: "published-learning-ids-only";
  };
};
