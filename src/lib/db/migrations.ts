export const UAIS_CORE_DATABASE_MIGRATIONS = [
  {
    version: "0001_core_poc",
    path: "migrations/0001_core_poc.sql",
    tables: [
      "uais_users",
      "uais_courses",
      "uais_lessons",
      "uais_classes",
      "uais_invite_codes",
      "uais_enrollments",
      "uais_assessments",
      "uais_submissions",
      "uais_learning_events",
      "uais_learner_profiles",
      "uais_recommendations",
      "uais_audit_log",
      "uais_export_jobs",
      "uais_provider_jobs",
      "uais_teaching_course_management_snapshots",
    ],
  },
] as const;
