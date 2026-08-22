"use client";

import { useCallback, useEffect, useState } from "react";
import type { Locale } from "@/i18n/copy";
import type {
  LearningPptPlaybackManifest,
  LearningPptPlaybackSlide,
} from "@/lib/learning/ppt-playback-types";
import {
  getPublishedPlaybackError,
  type PublishedPlaybackError,
} from "./learning-page-helpers";

export function usePublishedLearningPlayback({
  courseId,
  locale,
}: {
  courseId: string;
  locale: Locale;
}) {
  const [publishedPlayback, setPublishedPlayback] =
    useState<LearningPptPlaybackManifest>();
  const [publishedPlaybackError, setPublishedPlaybackError] =
    useState<PublishedPlaybackError>();
  const [isPublishedPlaybackLoading, setIsPublishedPlaybackLoading] = useState(true);
  const [activePublishedSlideIndex, setActivePublishedSlideIndex] = useState(0);
  const [requestRevision, setRequestRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadPublishedPlayback() {
      setIsPublishedPlaybackLoading(true);
      setPublishedPlayback(undefined);
      setPublishedPlaybackError(undefined);
      setActivePublishedSlideIndex(0);
      try {
        const response = await fetch(
          `/api/learning/ppt-playback/${encodeURIComponent(courseId)}?locale=${encodeURIComponent(locale)}`,
        );
        if (!response.ok) {
          if (!cancelled) {
            setPublishedPlaybackError(getPublishedPlaybackError(response.status));
          }
          return;
        }
        const body = (await response.json()) as {
          playback?: LearningPptPlaybackManifest;
        };
        if (!cancelled && body.playback && body.playback.slides.length > 0) {
          setPublishedPlayback(body.playback);
          return;
        }
        if (!cancelled) {
          setPublishedPlaybackError("unavailable");
        }
      } catch {
        if (!cancelled) {
          setPublishedPlaybackError("unavailable");
        }
      } finally {
        if (!cancelled) {
          setIsPublishedPlaybackLoading(false);
        }
      }
    }

    void loadPublishedPlayback();
    return () => {
      cancelled = true;
    };
  }, [courseId, locale, requestRevision]);

  const retryPublishedPlayback = useCallback(() => {
    setRequestRevision((current) => current + 1);
  }, []);
  const activePublishedSlide: LearningPptPlaybackSlide | undefined =
    publishedPlayback?.slides[activePublishedSlideIndex] ?? publishedPlayback?.slides[0];

  return {
    publishedPlayback,
    publishedPlaybackError,
    isPublishedPlaybackLoading,
    activePublishedSlide,
    activePublishedSlideIndex,
    setActivePublishedSlideIndex,
    retryPublishedPlayback,
  };
}
