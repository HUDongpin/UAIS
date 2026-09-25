"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import type { TeacherCourse } from "@/data/uais";
import {
  resolveTeacherWorkbenchCourses,
  shouldLoadPersistedTeachingCourses,
} from "@/lib/teaching/course-readback";

function subscribeToTeachingOwnershipPath() {
  return () => {};
}

function readTeachingOwnershipLoadExpected() {
  return shouldLoadPersistedTeachingCourses();
}

function readTeachingOwnershipLoadExpectedOnServer() {
  return false;
}

export function useTeachingWorkbenchWriteAccess() {
  // The course list only loads on /teaching. While that read is outstanding,
  // `writableCourseIds` stays undefined — the #10 fail-open signal — so selected
  // writes must treat the load as unresolved instead. The server snapshot stays
  // false so hydration matches the first client render before the browser path
  // is known; client renders (including tests) read the real path immediately.
  const ownershipLoadExpected = useSyncExternalStore(
    subscribeToTeachingOwnershipPath,
    readTeachingOwnershipLoadExpected,
    readTeachingOwnershipLoadExpectedOnServer,
  );
  const [writableCourseIds, setWritableCourseIds] = useState<Set<string>>();
  const [catalogDemoCoursesVisible, setCatalogDemoCoursesVisible] = useState(false);
  const ownershipUnresolved = ownershipLoadExpected && writableCourseIds === undefined;

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
    ownershipUnresolved,
    catalogDemoCoursesVisible,
    applyWorkbenchCourses,
    markCatalogDemoReadOnly,
  };
}
