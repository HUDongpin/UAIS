"use client";

import { useEffect, useState } from "react";

export type OwnedTeachingCourseAccess = "unknown" | "owned" | "unowned";

type TeachingCourseListBody = {
  courses?: Array<{ courseId?: string }>;
};

type ListedCourses = {
  forCourseId: string;
  courseIds: string[] | "unknown";
};

export function useOwnedTeachingCourseAccess(courseId: string | undefined) {
  const selectedCourseId = courseId?.trim() ?? "";
  const [listed, setListed] = useState<ListedCourses | undefined>(undefined);

  useEffect(() => {
    if (!selectedCourseId || typeof fetch !== "function") {
      return;
    }

    let cancelled = false;
    async function readOwnedCourses() {
      try {
        const response = await fetch("/api/teaching/courses", {
          method: "GET",
          headers: { accept: "application/json" },
          cache: "no-store",
        });
        const body = (await response.json().catch(() => null)) as TeachingCourseListBody | null;
        if (cancelled) {
          return;
        }
        if (!response.ok || !body || !Array.isArray(body.courses)) {
          // Operation-page tests mock fetch for POST receipts. A 200 without a
          // course list is not proof of non-ownership; keep writes enabled.
          setListed({ forCourseId: selectedCourseId, courseIds: "unknown" });
          return;
        }
        setListed({
          forCourseId: selectedCourseId,
          courseIds: body.courses
            .map((course) => course.courseId?.trim())
            .filter((id): id is string => Boolean(id)),
        });
      } catch {
        if (!cancelled) {
          setListed({ forCourseId: selectedCourseId, courseIds: "unknown" });
        }
      }
    }

    void readOwnedCourses();
    return () => {
      cancelled = true;
    };
  }, [selectedCourseId]);

  if (!selectedCourseId) {
    return "unknown";
  }
  if (!listed || listed.forCourseId !== selectedCourseId) {
    return "unknown";
  }
  if (listed.courseIds === "unknown") {
    return "unknown";
  }
  return listed.courseIds.includes(selectedCourseId) ? "owned" : "unowned";
}
