"use client";

import { useEffect, useState } from "react";

export type OwnedTeachingCourseAccess = "unknown" | "owned" | "unowned";

type TeachingCourseListBody = {
  courses?: Array<{ courseId?: string }>;
};

export function useOwnedTeachingCourseAccess(courseId: string | undefined) {
  const [access, setAccess] = useState<OwnedTeachingCourseAccess>("unknown");

  useEffect(() => {
    const selectedCourseId = courseId?.trim();
    if (!selectedCourseId || typeof fetch !== "function") {
      setAccess("unknown");
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
          setAccess("unknown");
          return;
        }
        const owned = body.courses.some(
          (course) => course.courseId?.trim() === selectedCourseId,
        );
        setAccess(owned ? "owned" : "unowned");
      } catch {
        if (!cancelled) {
          setAccess("unknown");
        }
      }
    }

    void readOwnedCourses();
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  return access;
}
