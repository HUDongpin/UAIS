// The student's own view of `/api/teaching/courses`: which classes they were
// approved into, and where "Enter Learning" for one of them actually goes.
//
// Shared by the student dashboard and the course plaza. Both surfaces used to
// present the template's two sample courses as the student's own - the plaza
// rendered nothing but them - so both now read the same real membership list
// through one parser rather than two drifting copies.

export type StudentMembershipCourseResponse = {
  courses?: Array<{
    courseId?: string;
    courseName?: string;
    semester?: string;
  }>;
  classes?: Array<{
    classId?: string;
    courseId?: string;
    className?: string;
    semester?: string;
  }>;
  memberships?: Array<{
    membershipId?: string;
    courseId?: string;
    classId?: string;
    membershipStatus?: string;
    joinedAt?: string;
    approvedAt?: string;
  }>;
};

export type StudentClassMembershipItem = {
  id: string;
  courseId: string;
  classId: string;
  courseName: string;
  className: string;
  semester: string;
  // `rejected` and `removed` are CLOSED rows: the route reports them so a class
  // that leaves the student's list can say why instead of silently disappearing.
  // Neither ever carries an entry link - see `isClosedStudentMembership`.
  membershipStatus: "approved" | "pending-teacher-review" | "rejected" | "removed";
};

// The two statuses that mean "this class is over for you". Kept as one predicate
// so the dashboard and the plaza cannot drift on which rows lose their link.
export function isClosedStudentMembership(membership: StudentClassMembershipItem) {
  return (
    membership.membershipStatus === "rejected" || membership.membershipStatus === "removed"
  );
}

export function createStudentClassMembershipItems(
  response: StudentMembershipCourseResponse,
): StudentClassMembershipItem[] {
  const coursesById = new Map(
    (response.courses ?? [])
      .map((course) => {
        const courseId = course.courseId?.trim();
        const courseName = course.courseName?.trim();
        if (!courseId || !courseName) {
          return undefined;
        }
        return [
          courseId,
          {
            courseName,
            semester: course.semester?.trim() ?? "",
          },
        ] as const;
      })
      .filter((course): course is readonly [string, { courseName: string; semester: string }] =>
        Boolean(course),
      ),
  );
  const classesById = new Map(
    (response.classes ?? [])
      .map((classItem) => {
        const classId = classItem.classId?.trim();
        const courseId = classItem.courseId?.trim();
        const className = classItem.className?.trim();
        if (!classId || !courseId || !className) {
          return undefined;
        }
        return [
          classId,
          {
            courseId,
            className,
            semester: classItem.semester?.trim() ?? "",
          },
        ] as const;
      })
      .filter(
        (
          classItem,
        ): classItem is readonly [
          string,
          { courseId: string; className: string; semester: string },
        ] => Boolean(classItem),
      ),
  );

  return (response.memberships ?? [])
    .map((membership) => {
      const membershipId = membership.membershipId?.trim();
      const classId = membership.classId?.trim();
      if (!membershipId || !classId) {
        return undefined;
      }
      const classItem = classesById.get(classId);
      if (!classItem) {
        return undefined;
      }
      const course = coursesById.get(classItem.courseId);
      if (!course) {
        return undefined;
      }

      return {
        id: membershipId,
        courseId: classItem.courseId,
        classId,
        courseName: course.courseName,
        className: classItem.className,
        semester: classItem.semester || course.semester,
        // Anything the route does not name explicitly still lands on
        // `pending-teacher-review`, which is the one status that promises the
        // student nothing and grants nothing.
        membershipStatus: readStudentMembershipStatus(membership.membershipStatus),
      } satisfies StudentClassMembershipItem;
    })
    .filter((membership): membership is StudentClassMembershipItem => Boolean(membership));
}

function readStudentMembershipStatus(
  value: string | undefined,
): StudentClassMembershipItem["membershipStatus"] {
  if (value === "approved" || value === "rejected" || value === "removed") {
    return value;
  }
  return "pending-teacher-review";
}

// Both ids are required: `/learning` alone falls back to the template's demo
// course id, which the playback route refuses for a real student.
export function createStudentMembershipLearningHref(membership: {
  courseId: string;
  classId: string;
}) {
  const params = new URLSearchParams({
    courseId: membership.courseId,
    classId: membership.classId,
  });
  return `/learning?${params.toString()}`;
}
