"use client";

import { useCallback, useState } from "react";
import type { TeacherCourse } from "@/data/uais";
import { resolveTeacherWorkbenchCourses } from "@/lib/teaching/course-readback";

export function useTeachingWorkbenchWriteAccess() {
  const [writableCourseIds, setWritableCourseIds] = useState<Set<string>>();
  const [catalogDemoCoursesVisible, setCatalogDemoCoursesVisible] = useState(false);

  const applyWorkbenchCourses = useCallback(
    (input: { persistedCourses: TeacherCourse[]; catalogCourses: TeacherCourse[] }) => {
      const workbench = resolveTeacherWorkbenchCourses(input);
      setWritableCourseIds(new Set(workbench.writableCourseIds));
      setCatalogDemoCoursesVisible(workbench.catalogDemo);
      return workbench.courses;
    },
    [],
  );

  const markCatalogDemoReadOnly = useCallback(() => {
    setWritableCourseIds(new Set());
    setCatalogDemoCoursesVisible(true);
  }, []);

  return {
    writableCourseIds,
    catalogDemoCoursesVisible,
    applyWorkbenchCourses,
    markCatalogDemoReadOnly,
  };
}
