import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function sliceRequiredSection(sourceText: string, startNeedle: string, endNeedle: string) {
  const startIndex = sourceText.indexOf(startNeedle);
  expect(startIndex).toBeGreaterThan(-1);
  const endIndex = sourceText.indexOf(endNeedle, startIndex);
  expect(endIndex).toBeGreaterThan(startIndex);
  return sourceText.slice(startIndex, endIndex);
}

function extractRouteMethodPairs(section: string) {
  return [...section.matchAll(/(?:route|reportRoute): "([^"]+)"[\s\S]*?method: "([^"]+)"/g)]
    .map(([, route, method]) => ({ route, method }));
}

function extractDeniedProbeContracts(section: string) {
  return [
    ...section.matchAll(
      /route: "([^"]+)"[\s\S]*?method: "([^"]+)"[\s\S]*?expectedStatus: (\d+)[\s\S]*?(?:expectedReasonCode|reasonCode): "([^"]+)"/g,
    ),
  ].map(([, route, method, expectedStatus, reasonCode]) => ({
    route,
    method,
    expectedStatus: Number(expectedStatus),
    reasonCode,
  }));
}

describe("enterprise closed-loop regression guards", () => {
  it("keeps teaching operation detail audit verification gated by full signed teacher session readback", () => {
    const page = source("src/components/teaching/teaching-operation-page.tsx");
    const pageTest = source("tests/teaching-operation-page.test.tsx");
    const auditReadbackSection = sliceRequiredSection(
      page,
      "async function readOperationAuditEvidence",
      "function doesOperationPageDomainProjectionMatchBusinessSemantics",
    );

    expect(page).toContain("function isVerifiedOperationAuditAuthSession");
    expect(page).toContain('typeof authSession?.sessionId === "string"');
    expect(page).toContain('typeof authSession.authenticatedAt === "string"');
    expect(page).toContain('typeof authSession.expiresAt === "string"');
    expect(
      auditReadbackSection.indexOf(
        "!isVerifiedOperationAuditAuthSession(matchingAuditEvent.authSession)",
      ),
    ).toBeLessThan(auditReadbackSection.indexOf('status: "verified"'));
    expect(pageTest).toContain(
      "requires a complete signed teacher session before verifying operation page audit readback",
    );
    expect(pageTest).toContain("weak-operation-page-session");
  });

  it("keeps operation detail transient artifacts cleared before retry persistence", () => {
    const page = source("src/components/teaching/teaching-operation-page.tsx");
    const pageTest = source("tests/teaching-operation-page.test.tsx");
    const actionSection = sliceRequiredSection(
      page,
      "async function persistTeachingOperationAction",
      "async function readOperationAuditEvidence",
    );
    const auditResetIndex = actionSection.indexOf("setAuditStatus(undefined)");
    const artifactResetIndex = actionSection.indexOf("resetTransientArtifactsForAction(actionSlot)");
    const fetchIndex = actionSection.indexOf('fetch("/api/teaching/operations"');

    expect(page).toContain("function resetTransientArtifactsForAction");
    expect(auditResetIndex).toBeGreaterThan(-1);
    expect(artifactResetIndex).toBeGreaterThan(auditResetIndex);
    expect(fetchIndex).toBeGreaterThan(artifactResetIndex);
    expect(pageTest).toContain(
      "clears a stale operation page export manifest before a retried export save fails",
    );
    expect(pageTest).toContain(
      "clears a stale operation page invite code before a retried invite generation fails",
    );
  });

  it("keeps main teaching inline operation receipts gated by signed teacher-session evidence", () => {
    const page = source("src/components/pages/teaching-page.tsx");
    const pageTest = source("tests/teaching-page.test.tsx");
    const inlineActionSection = sliceRequiredSection(
      page,
      "async function runInlineWorkspaceAction",
      "async function readInlineWorkspaceAuditEvidence",
    );

    expect(page).toContain("function hasSignedInlineTeachingOperationReceiptAudit");
    expect(page).toContain('receipt?.audit?.authMode === "signed-teacher-session"');
    expect(page).toContain("hasCompleteInlineTeachingAuthSession(receipt.audit.authSession)");
    expect(
      inlineActionSection.indexOf("!hasSignedInlineTeachingOperationReceiptAudit(payload.receipt)"),
    ).toBeLessThan(inlineActionSection.indexOf("void readInlineWorkspaceAuditEvidence"));
    expect(pageTest).toContain(
      "requires signed teacher-session evidence in the inline operation receipt before audit readback",
    );
    expect(pageTest).toContain("trace-inline-receipt-session-missing");
  });

  it("keeps main invite publication gated by persisted class invitation readback", () => {
    const page = source("src/components/pages/teaching-page.tsx");
    const pageTest = source("tests/teaching-page.test.tsx");
    const inviteActionSection = sliceRequiredSection(
      page,
      "async function runInviteWorkspaceAction",
      "async function readInviteWorkspaceAuditEvidence",
    );
    const inviteAuditSection = sliceRequiredSection(
      page,
      "async function readInviteWorkspaceAuditEvidence",
      "function resolveInviteWorkspaceTargetClassId",
    );

    expect(page).toContain("INVITE_CLASS_INVITATION_READBACK_MISMATCH_MESSAGE");
    expect(page).toContain("async function applyInviteWorkspaceReceiptWithPublicationReadback");
    expect(inviteActionSection).toContain("await applyInviteWorkspaceReceiptWithPublicationReadback");
    expect(inviteAuditSection).toContain("await applyInviteWorkspaceReceiptWithPublicationReadback");
    expect(inviteAuditSection).toContain("readPersistedTeachingCourseState");
    expect(inviteAuditSection).toContain("applyPersistedTeachingCourseReadback(readback)");
    expect(inviteAuditSection).toContain("setSelectedClassInvitation(readbackClass)");
    expect(pageTest).toContain(
      "requires class invitation-code readback before changing the published invite code",
    );
    expect(pageTest).toContain("班级邀请码读回未匹配发布结果，请稍后刷新。");
  });

  it("keeps teaching membership approval UI gated by persisted course-state readback", () => {
    const page = source("src/components/pages/teaching-page.tsx");
    const pageTest = source("tests/teaching-page.test.tsx");
    const approvalSection = sliceRequiredSection(
      page,
      "async function approveClassMembership",
      "const newClassCourse",
    );
    const receiptCheckIndex = approvalSection.indexOf("isPersistedMembershipApprovalReceipt");
    const readbackIndex = approvalSection.indexOf(
      "const readback = await readPersistedTeachingCourseState()",
    );
    const applyReadbackIndex = approvalSection.indexOf("applyPersistedTeachingCourseReadback(readback)");
    const successStatusIndex = approvalSection.indexOf("readbackMembership.studentDisplayName");

    expect(page).toContain("MEMBERSHIP_APPROVAL_READBACK_MISSING_MESSAGE");
    expect(page).toContain("MEMBERSHIP_APPROVAL_READBACK_MISMATCH_MESSAGE");
    expect(readbackIndex).toBeGreaterThan(receiptCheckIndex);
    expect(readbackIndex).toBeLessThan(applyReadbackIndex);
    expect(applyReadbackIndex).toBeLessThan(successStatusIndex);
    expect(pageTest).toContain(
      "requires membership approval readback before marking a student as joined",
    );
  });

  it("keeps ordinary teaching operations fail-closed on signed teacher auth, course ownership, and external production storage", () => {
    const route = source("src/app/api/teaching/operations/route.ts");
    const store = source("src/lib/server/teaching-operations-store.ts");

    expect(route).not.toContain("teacher-kang");
    expect(route).toContain("readAuthenticatedTeacherSession");
    expect(route).toContain("readAuthenticatedStudentSession");
    expect(route).toContain("getUaisAppSessionClaimsFromCookieString");
    expect(route).toContain("!isSafeTeachingOperationId(claims.sessionId)");
    expect(route).toContain("authenticatedTeacher.role !== \"teacher\"");
    expect(route).toContain("authorizeTeachingOperationCourseAccess");
    expect(route).toContain("assertProductionTeachingOperationCourseOwnershipAccessConfigured");
    expect(route).toContain("Production teaching operation persistence requires external storage.");
    expect(route).toContain("env,");
    expect(route).toContain("actorId: authenticatedTeacher.actorId");
    expect(store).toContain("env?: Record<string, string | undefined>;");
    expect(store).toContain("isTeachingOperationProductionRuntime(input.env ?? process.env)");
    expect(store).toContain("!usingExternalPersistence");
    expect(store).toContain("Production teaching operation persistence requires external storage.");

    expect(route.indexOf("const authenticatedTeacher = readAuthenticatedTeacherSession")).toBeLessThan(
      route.indexOf("const body = await readJsonBody(request)"),
    );
    expect(route.indexOf("const access = await authorizeTeachingOperationCourseAccess")).toBeLessThan(
      route.indexOf("const receipt = await executeTeachingOperationAction"),
    );
  });

  it("keeps ordinary teaching operation route smoke readbacks bound to the signed teacher under test", () => {
    const smoke = source("scripts/teaching-operations-route-smoke.mjs");
    const helperSection = sliceRequiredSection(
      smoke,
      "function isAuditReadbackBodyReady",
      "function parseArgs",
    );

    expect(smoke).toContain("let expectedSmokeTeacherId");
    expect(smoke).toContain("setExpectedSmokeTeacherId(expectedTeacherId)");
    expect(smoke).toContain("function getExpectedSmokeTeacherId()");
    expect(helperSection).not.toContain('"teacher-kang"');
    expect(helperSection).toContain("getExpectedSmokeTeacherId()");
  });

  it("keeps ordinary teaching provider side effects production-preflighted before operation writes", () => {
    const route = source("src/app/api/teaching/operations/route.ts");
    const preflightCallIndex = route.indexOf("preflightProductionProviderSideEffects({");

    expect(route).toContain("function preflightProductionProviderSideEffects");
    expect(preflightCallIndex).toBeGreaterThan(-1);
    expect(preflightCallIndex).toBeLessThan(
      route.indexOf("const receipt = await executeTeachingOperationAction"),
    );
    expect(preflightCallIndex).toBeLessThan(
      route.indexOf("const domainPersistence = await persistTeachingOperationDomainObjects"),
    );

    const preflightSection = route.slice(
      route.indexOf("function preflightProductionProviderSideEffects"),
      route.indexOf("function assertProviderSideEffectConfigured"),
    );
    const providerRequirements = [
      {
        operation: 'input.operationId === "students" && input.actionSlot === "primary"',
        reader: "readStudentRosterSyncProviderConfig(input.env)",
        error: "Student roster sync provider is not configured.",
      },
      {
        operation: 'input.operationId === "knowledge-base" && input.actionSlot === "primary"',
        reader: "readKnowledgeIndexSyncProviderConfig(input.env)",
        error: "Knowledge index sync provider is not configured.",
      },
      {
        operation: 'input.operationId === "content" && input.actionSlot === "primary"',
        reader: "readCourseContentPublishProviderConfig(input.env)",
        error: "Course content publish provider is not configured.",
      },
      {
        operation: 'input.operationId === "admins" && input.actionSlot === "secondary"',
        reader: "readCollaborationInviteEmailProviderConfig(input.env)",
        error: "Collaboration invite email provider is not configured.",
      },
      {
        operation: 'input.operationId === "data-export" && input.actionSlot === "primary"',
        reader: "readCourseExportProviderConfig(input.env)",
        error: "Course export provider is not configured.",
      },
      {
        operation: 'input.operationId === "grading" && input.actionSlot === "secondary"',
        reader: "readGradingFeedbackProviderConfig(input.env)",
        error: "Grading feedback provider is not configured.",
      },
    ];

    for (const requirement of providerRequirements) {
      expect(preflightSection).toContain(requirement.operation);
      expect(preflightSection).toContain(requirement.reader);
      expect(preflightSection).toContain(requirement.error);
    }

    const providerConfigReaders = route.slice(
      route.indexOf("function readStudentRosterSyncProviderConfig"),
      route.indexOf("function readProviderDeliveryId"),
    );
    expect(providerConfigReaders).toContain("token.length < 32");
    expect(providerConfigReaders).toContain("readExternalTeachingProviderUrl");
    expect(providerConfigReaders).toContain("UAIS_LOCAL_PRODUCTION_E2E_ALLOW_INSECURE_TEACHING_PROVIDER_FIXTURE");
    expect(providerConfigReaders).toContain('env.UAIS_DEPLOYMENT_ENV === "local-production"');
    expect(providerConfigReaders).toContain('url.protocol !== "https:"');
    expect(providerConfigReaders).toContain('url.protocol === "http:"');
    expect(providerConfigReaders).toContain("isDisallowedExternalTeachingProviderHost");
    expect(providerConfigReaders).toContain('host === "localhost"');
    expect(providerConfigReaders).toContain("octets[0] === 127");
    expect(providerConfigReaders).toContain("octets[0] === 10");
  });

  it("keeps ordinary teaching operation routes production-gated by UAIS_DEPLOYMENT_ENV", () => {
    const teachingOperationRouteFiles = [
      "src/app/api/teaching/operations/route.ts",
      "src/app/api/teaching/operations/audit/route.ts",
      "src/app/api/teaching/operations/audit/alerts/route.ts",
      "src/app/api/teaching/operations/audit/alerts/notifications/route.ts",
      "src/app/api/teaching/operations/backups/[backupId]/restore/route.ts",
      "src/app/api/teaching/operations/export/[manifestId]/route.ts",
      "src/app/api/teaching/operations/records/[recordId]/rollback/route.ts",
      "src/app/api/teaching/gradebook-updates/[objectId]/release/route.ts",
      "src/app/api/teaching/gradebook-updates/[objectId]/rollback/route.ts",
    ];

    for (const routeFile of teachingOperationRouteFiles) {
      const route = source(routeFile);
      const productionRuntimeSection = route.slice(
        route.indexOf("function isTeachingOperationProductionRuntime"),
      );
      expect(productionRuntimeSection, routeFile).toContain("env.VERCEL_ENV === \"production\"");
      expect(productionRuntimeSection, routeFile).toContain("env.NODE_ENV === \"production\"");
      expect(productionRuntimeSection, routeFile).toContain(
        "env.UAIS_DEPLOYMENT_ENV === \"production\"",
      );
    }
  });

  it("keeps teaching API signed-student deny paths validating full app-session claims", () => {
    const teachingStudentDenyRouteGuards = [
      {
        routeFile: "src/app/api/teaching/operations/route.ts",
        readerCall: "const authenticatedStudent = readAuthenticatedStudentSession",
        sessionGuard: "!isSafeTeachingOperationId(claims.sessionId)",
      },
      {
        routeFile: "src/app/api/teaching/operations/audit/route.ts",
        readerCall: "const authenticatedStudent = readAuthenticatedStudent",
        sessionGuard: "!isSafeTeachingOperationId(claims.sessionId)",
      },
      {
        routeFile: "src/app/api/teaching/operations/audit/alerts/route.ts",
        readerCall: "const authenticatedStudent = readAuthenticatedStudent",
        sessionGuard: "!isSafeTeachingOperationAuditAlertActorId(claims.sessionId)",
      },
      {
        routeFile: "src/app/api/teaching/operations/audit/alerts/notifications/route.ts",
        readerCall: "const authenticatedStudent = readAuthenticatedStudent",
        sessionGuard: "!isSafeTeachingOperationAuditAlertNotificationActorId(claims.sessionId)",
      },
      {
        routeFile: "src/app/api/teaching/operations/backups/[backupId]/restore/route.ts",
        readerCall: "const authenticatedStudent = readAuthenticatedStudent",
        sessionGuard: "!isSafeTeachingOperationId(claims.sessionId)",
      },
      {
        routeFile: "src/app/api/teaching/operations/export/[manifestId]/route.ts",
        readerCall: "const authenticatedStudent = readAuthenticatedStudent",
        sessionGuard: "!isSafeTeachingOperationId(claims.sessionId)",
      },
      {
        routeFile: "src/app/api/teaching/operations/records/[recordId]/rollback/route.ts",
        readerCall: "const authenticatedStudent = readAuthenticatedStudent",
        sessionGuard: "!isSafeTeachingOperationId(claims.sessionId)",
      },
      {
        routeFile: "src/app/api/teaching/gradebook-updates/[objectId]/release/route.ts",
        readerCall: "const authenticatedStudent = readAuthenticatedStudent",
        sessionGuard: "!isSafeTeachingOperationId(claims.sessionId)",
      },
      {
        routeFile: "src/app/api/teaching/gradebook-updates/[objectId]/rollback/route.ts",
        readerCall: "const authenticatedStudent = readAuthenticatedStudent",
        sessionGuard: "!isSafeTeachingOperationId(claims.sessionId)",
      },
      {
        routeFile: "src/app/api/teaching/courses/route.ts",
        readerCall: "const authenticatedStudent = readAuthenticatedStudent",
        sessionGuard: "!isSafeTeachingCourseActorId(claims.sessionId)",
      },
      {
        routeFile: "src/app/api/teaching/courses/[courseId]/classes/route.ts",
        readerCall: "const authenticatedStudent = readAuthenticatedStudent",
        sessionGuard: "!isSafeTeachingClassActorId(claims.sessionId)",
      },
      {
        routeFile: "src/app/api/teaching/classes/[classId]/memberships/[membershipId]/approve/route.ts",
        readerCall: "const authenticatedStudent = readAuthenticatedStudent",
        sessionGuard: "!isSafeTeachingMembershipActorId(claims.sessionId)",
      },
      {
        routeFile: "src/app/api/teaching/invite-codes/[code]/join/route.ts",
        readerCall: "authenticatedStudent = readAuthenticatedStudent",
        sessionGuard: "!isSafeTeachingInviteStudentActorId(claims.sessionId)",
      },
      {
        routeFile: "src/app/api/teaching/course-cover/route.ts",
        readerCall: "const authenticatedStudent = readAuthenticatedStudent",
        sessionGuard: "isSafeTeachingCourseCoverActorId(claims.sessionId)",
      },
    ];

    for (const { routeFile, readerCall, sessionGuard } of teachingStudentDenyRouteGuards) {
      const route = source(routeFile);

      expect(route, routeFile).toContain(readerCall);
      expect(route, routeFile).toContain("getUaisAppSessionClaimsFromCookieString");
      expect(route, routeFile).toContain(sessionGuard);
      expect(route, routeFile).not.toContain("getUaisAppSessionUserFromCookieString");
    }
  });

  it("keeps teaching export downloads closed to signed students before manifest readback", () => {
    const route = source("src/app/api/teaching/operations/export/[manifestId]/route.ts");

    expect(route).toContain("const authenticatedStudent = readAuthenticatedStudent");
    expect(route).toContain("UAIS teacher role is required.");
    expect(route).toContain("teacher-role-required");
    expect(route).toContain("const authenticatedTeacher = readAuthenticatedTeacher");
    expect(route).toContain("const manifest = await readExportManifest");
    expect(route.indexOf("const authenticatedStudent = readAuthenticatedStudent")).toBeLessThan(
      route.indexOf("const authenticatedTeacher = readAuthenticatedTeacher"),
    );
    expect(route.indexOf("const authenticatedStudent = readAuthenticatedStudent")).toBeLessThan(
      route.indexOf("const manifest = await readExportManifest"),
    );
  });

  it("keeps teaching audit readback closed to signed students before audit storage readback", () => {
    const route = source("src/app/api/teaching/operations/audit/route.ts");
    const externalStorageService = source("scripts/external-storage-service.mjs");
    const externalStorageRouteService = source(
      "src/lib/server/external-storage-route-service.ts",
    );

    expect(route).toContain("const authenticatedStudent = readAuthenticatedStudent");
    expect(route).toContain("UAIS teacher role is required.");
    expect(route).toContain("teacher-role-required");
    expect(route).toContain("const authenticatedTeacher = readAuthenticatedTeacher");
    expect(route).toContain("const externalAudit =");
    expect(route.indexOf("const authenticatedStudent = readAuthenticatedStudent")).toBeLessThan(
      route.indexOf("const authenticatedTeacher = readAuthenticatedTeacher"),
    );
    expect(route.indexOf("const authenticatedStudent = readAuthenticatedStudent")).toBeLessThan(
      route.indexOf("const externalAudit ="),
    );
    expect(route).toContain("isTeachingOperationProductionRuntime(input.env)");
    expect(route).toContain(
      "External teaching operation audit readback is missing production database adapter evidence.",
    );
    expect(route).toContain("productionDatabaseAdapter");
    expect(externalStorageService).toContain(
      "assertProductionDatabaseAdapterReadyForAuditReadback(config)",
    );
    expect(externalStorageService).toContain(
      "Production external storage audit readback requires ready managed database adapter proof.",
    );
    expect(externalStorageRouteService).toContain(
      "assertProductionDatabaseAdapterReadyForAuditReadback(config)",
    );
    expect(externalStorageRouteService).toContain(
      "Production external storage audit readback requires ready managed database adapter proof.",
    );
  });

  it("keeps external storage service readiness split by ordinary teaching schema", () => {
    const readiness = source("scripts/external-storage-service-readiness.mjs");
    const enterpriseAudit = source("scripts/enterprise-live-evidence-audit.mjs");
    const releaseGate = source("scripts/production-e2e-release-gate.mjs");
    const acceptancePacket = source(
      "coordination/reports/2026-06-28-enterprise-live-acceptance-packet.md",
    );

    for (const resultKey of [
      "externalStorageTeachingOperationsSchema",
      "externalStorageTeachingCourseManagementSchema",
      "externalStorageTeachingCourseAssetsSchema",
    ]) {
      expect(readiness).toContain(resultKey);
      expect(enterpriseAudit).toContain(resultKey);
      expect(acceptancePacket).toContain(resultKey);
    }
    expect(releaseGate).toContain("enterpriseLiveEvidenceAuditSource");
    expect(releaseGate).toContain(
      "\"external-storage-service-readiness\": requiredExternalStorageServiceReadinessResultKeys",
    );
    expect(readiness).toContain("isExternalStorageTeachingOperationsSchemaProved");
    expect(readiness).toContain("isExternalStorageTeachingCourseManagementSchemaProved");
    expect(readiness).toContain("isExternalStorageTeachingCourseAssetsSchemaProved");
    expect(readiness).toContain("isProductionDatabaseAdapterHealthReady");
  });

  it("keeps teaching audit alert routes closed to signed students before alert storage access", () => {
    const alertsRoute = source("src/app/api/teaching/operations/audit/alerts/route.ts");
    const notificationRoute = source(
      "src/app/api/teaching/operations/audit/alerts/notifications/route.ts",
    );
    const externalStorageService = source("scripts/external-storage-service.mjs");
    const externalStorageRouteService = source(
      "src/lib/server/external-storage-route-service.ts",
    );
    const notificationGet = notificationRoute.slice(
      notificationRoute.indexOf("return async function GET"),
      notificationRoute.indexOf("return async function POST"),
    );
    const notificationPost = notificationRoute.slice(
      notificationRoute.indexOf("return async function POST"),
    );

    expect(alertsRoute).toContain("const authenticatedStudent = readAuthenticatedStudent");
    expect(alertsRoute).toContain("UAIS teacher role is required.");
    expect(alertsRoute).toContain("teacher-role-required");
    expect(alertsRoute.indexOf("const authenticatedStudent = readAuthenticatedStudent")).toBeLessThan(
      alertsRoute.indexOf("const authenticatedTeacher = readAuthenticatedTeacher"),
    );
    expect(alertsRoute.indexOf("const authenticatedStudent = readAuthenticatedStudent")).toBeLessThan(
      alertsRoute.indexOf("const externalAlerts ="),
    );

    for (const handler of [notificationGet, notificationPost]) {
      expect(handler).toContain("const authenticatedStudent = readAuthenticatedStudent");
      expect(handler).toContain("UAIS teacher role is required.");
      expect(handler).toContain("teacher-role-required");
      expect(handler.indexOf("const authenticatedStudent = readAuthenticatedStudent")).toBeLessThan(
        handler.indexOf("const authenticatedTeacher = readAuthenticatedTeacher"),
      );
    }
    expect(notificationGet.indexOf("const authenticatedStudent = readAuthenticatedStudent")).toBeLessThan(
      notificationGet.indexOf("const readNotifications ="),
    );
    expect(notificationPost.indexOf("const authenticatedStudent = readAuthenticatedStudent")).toBeLessThan(
      notificationPost.indexOf("const enqueueNotifications ="),
    );

    expect(alertsRoute).toContain(
      "External teaching operation audit alert readback is missing production database adapter evidence.",
    );
    expect(notificationRoute).toContain(
      "External teaching operation audit alert notification dispatch is missing production database adapter evidence.",
    );
    expect(notificationRoute).toContain(
      "External teaching operation audit alert notification readback is missing production database adapter evidence.",
    );
    for (const storageSurface of [externalStorageService, externalStorageRouteService]) {
      expect(storageSurface).toContain(
        "assertProductionDatabaseAdapterReadyForAuditAlerts(config)",
      );
      expect(storageSurface).toContain(
        "assertProductionDatabaseAdapterReadyForAuditAlertNotifications(config)",
      );
      expect(storageSurface).toContain(
        "Production external storage audit alerts require ready managed database adapter proof.",
      );
      expect(storageSurface).toContain(
        "Production external storage audit alert notifications require ready managed database adapter proof.",
      );
    }
  });

  it("keeps teaching backup restore closed to signed students before restore handling", () => {
    const route = source("src/app/api/teaching/operations/backups/[backupId]/restore/route.ts");

    expect(route).toContain("const authenticatedStudent = readAuthenticatedStudent");
    expect(route).toContain("UAIS teacher role is required.");
    expect(route).toContain("teacher-role-required");
    expect(route).toContain("const authenticatedTeacher = readAuthenticatedTeacher");
    expect(route).toContain("assertSafeTeachingOperationBackupId");
    expect(route).toContain("createExternalRestoreDrillPlan");
    expect(route.indexOf("const authenticatedStudent = readAuthenticatedStudent")).toBeLessThan(
      route.indexOf("const authenticatedTeacher = readAuthenticatedTeacher"),
    );
    expect(route.indexOf("const authenticatedStudent = readAuthenticatedStudent")).toBeLessThan(
      route.indexOf("assertSafeTeachingOperationBackupId"),
    );
    expect(route.indexOf("const authenticatedStudent = readAuthenticatedStudent")).toBeLessThan(
      route.indexOf("createExternalRestoreDrillPlan"),
    );
  });

  it("keeps teaching operation rollback closed to signed students before rollback handling", () => {
    const route = source("src/app/api/teaching/operations/records/[recordId]/rollback/route.ts");

    expect(route).toContain("const authenticatedStudent = readAuthenticatedStudent");
    expect(route).toContain("UAIS teacher role is required.");
    expect(route).toContain("teacher-role-required");
    expect(route).toContain("const authenticatedTeacher = readAuthenticatedTeacher");
    expect(route).toContain("const body = await readJsonBody");
    expect(route).toContain("const { receipt } = await rollbackTeachingOperationRecord");
    expect(route.indexOf("const authenticatedStudent = readAuthenticatedStudent")).toBeLessThan(
      route.indexOf("const authenticatedTeacher = readAuthenticatedTeacher"),
    );
    expect(route.indexOf("const authenticatedStudent = readAuthenticatedStudent")).toBeLessThan(
      route.indexOf("const body = await readJsonBody"),
    );
    expect(route.indexOf("const authenticatedStudent = readAuthenticatedStudent")).toBeLessThan(
      route.indexOf("const { receipt } = await rollbackTeachingOperationRecord"),
    );
  });

  it("keeps app auth sessions deployment-gated by UAIS_DEPLOYMENT_ENV", () => {
    const appSession = source("src/lib/server/uais-app-session.ts");
    const appAuthProvider = source("src/lib/server/uais-app-auth-provider.ts");
    const appSessionRoute = source("src/app/api/auth/app-session/route.ts");
    const productionRuntimeSection = appSession.slice(
      appSession.indexOf("export function isUaisAppProductionRuntime"),
    );
    const deployedRuntimeSection = appSession.slice(
      appSession.indexOf("export function isUaisAppDeployedRuntime"),
    );

    expect(productionRuntimeSection).toContain("env.VERCEL_ENV === \"production\"");
    expect(productionRuntimeSection).toContain("env.NODE_ENV === \"production\"");
    expect(productionRuntimeSection).toContain(
      "env.UAIS_DEPLOYMENT_ENV === \"production\"",
    );
    expect(deployedRuntimeSection).toContain("isUaisAppProductionRuntime(env)");
    expect(deployedRuntimeSection).toContain("env.VERCEL_ENV === \"preview\"");
    expect(deployedRuntimeSection).toContain("deploymentEnv === \"preview\"");
    expect(deployedRuntimeSection).toContain("deploymentEnv === \"staging\"");
    expect(appSession).toContain("return isUaisAppDeployedRuntime(env)");
    expect(appAuthProvider).toContain("isUaisAppProductionRuntime(input.env)");
    expect(appSessionRoute).toContain("const isProductionRuntime = isUaisAppProductionRuntime(env)");
    expect(appSessionRoute).toContain("secure: isProductionRuntime");
    expect(appSessionRoute).not.toContain("secure: env.NODE_ENV === \"production\"");
    expect(appSessionRoute).not.toContain("env.NODE_ENV === \"production\" ? [\"Secure\"]");
  });

  it("keeps teacher AI session issuance production-gated by deployment env markers", () => {
    const route = source("src/app/api/ai/session/route.ts");
    const productionRuntimeSection = route.slice(
      route.indexOf("function isTeacherAiSessionProductionRuntime"),
    );

    expect(route).toContain("isTeacherAiSessionProductionRuntime(env)");
    expect(productionRuntimeSection).toContain("env.VERCEL_ENV === \"production\"");
    expect(productionRuntimeSection).toContain("env.NODE_ENV === \"production\"");
    expect(productionRuntimeSection).toContain(
      "env.UAIS_DEPLOYMENT_ENV === \"production\"",
    );
    expect(route).not.toContain(
      "env.NODE_ENV === \"production\" && authProviderContract.productionStatus !== \"ready\"",
    );
  });

  it("keeps AI direct API access-control production-gated by deployment env markers", () => {
    const accessControl = source("src/lib/server/ai-access-control.ts");
    const productionRuntimeSection = accessControl.slice(
      accessControl.indexOf("function isUaisAiProductionRuntime"),
    );

    expect(accessControl).toContain("isUaisAiProductionRuntime(input.env)");
    expect(accessControl).toContain("isUaisAiProductionRuntime(env)");
    expect(productionRuntimeSection).toContain("env.VERCEL_ENV === \"production\"");
    expect(productionRuntimeSection).toContain("env.NODE_ENV === \"production\"");
    expect(productionRuntimeSection).toContain(
      "env.UAIS_DEPLOYMENT_ENV === \"production\"",
    );
    expect(accessControl).not.toContain("input.env.NODE_ENV !== \"production\"");
    expect(accessControl).not.toContain("env.NODE_ENV === \"production\")");
  });

  it("keeps LangGraph runtime persistence production-gated by deployment env markers", () => {
    const runtime = source("src/lib/ai/langgraph-runtime/runtime.ts");
    const productionRuntimeSection = runtime.slice(
      runtime.indexOf("function isUaisLangGraphProductionRuntime"),
    );

    expect(runtime).toContain("isUaisLangGraphProductionRuntime(input.env)");
    expect(productionRuntimeSection).toContain("env.VERCEL_ENV === \"production\"");
    expect(productionRuntimeSection).toContain("env.NODE_ENV === \"production\"");
    expect(productionRuntimeSection).toContain(
      "env.UAIS_DEPLOYMENT_ENV === \"production\"",
    );
    expect(runtime).not.toContain("input.env.NODE_ENV !== \"production\"");
  });

  it("keeps teacher auth session issuer cookies secure under deployment production markers", () => {
    const route = source("src/app/api/ai/teacher-auth/issue/route.ts");
    const productionRuntimeSection = route.slice(
      route.indexOf("function isTeacherAuthSessionIssueProductionRuntime"),
    );

    expect(route).toContain("isTeacherAuthSessionIssueProductionRuntime(env)");
    expect(productionRuntimeSection).toContain("env.VERCEL_ENV === \"production\"");
    expect(productionRuntimeSection).toContain("env.NODE_ENV === \"production\"");
    expect(productionRuntimeSection).toContain(
      "env.UAIS_DEPLOYMENT_ENV === \"production\"",
    );
    expect(route).not.toContain("secure: env.NODE_ENV === \"production\"");
  });

  it("keeps the main teaching workspace API-backed instead of showing local-only success", () => {
    const page = source("src/components/pages/teaching-page.tsx");

    expect(page).toContain("const [authenticatedTeacherActorId, setAuthenticatedTeacherActorId]");
    expect(page).toContain("useState<string>();");
    expect(page).toContain('fetch("/api/teaching/operations"');
    expect(page).toContain("createTeachingOperationIdempotencyKey");
    expect(page).toContain("readInlineWorkspaceAuditEvidence");
    expect(page).toContain("createInlineDomainPersistenceFailureStatus");
    expect(page).toContain("TEACHING_OPERATION_SAVE_FAILED_MESSAGE");
    expect(page).toContain("verifyCourseCoverAssetPersistence");
    expect(page).toContain("TEACHING_COURSE_COVER_ASSET_PERSISTENCE_REQUIRED_MESSAGE");
    expect(page).toContain("TEACHING_COURSE_COVER_AUDIT_REQUIRED_MESSAGE");
    expect(page).toContain('payload.assetPersistence?.status !== "persisted"');
    expect(page).toContain('payload.audit.authMode === "signed-teacher-session"');
    expect(page).toContain("teacherActorId={authenticatedTeacherActorId}");
    expect(page).toContain("function requireTeacherWorkflowActorId");
    expect(page).not.toContain("DEFAULT_TEACHER_ID");
    expect(page).not.toContain("?? DEFAULT_TEACHER_ID");
    expect(page).not.toContain("teacherId: DEFAULT_TEACHER_ID");

    expect(page.indexOf('fetch("/api/teaching/operations"')).toBeLessThan(
      page.indexOf("applyVerifiedCourseSettingsPatch(courseId"),
    );
  });

  it("keeps ordinary course management APIs auth-scoped, domain-mutating, and production-durable", () => {
    const courseRoute = source("src/app/api/teaching/courses/route.ts");
    const classRoute = source("src/app/api/teaching/courses/[courseId]/classes/route.ts");
    const inviteJoinRoute = source("src/app/api/teaching/invite-codes/[code]/join/route.ts");
    const membershipApproveRoute = source(
      "src/app/api/teaching/classes/[classId]/memberships/[membershipId]/approve/route.ts",
    );
    const collaborationInviteDeliveryCallbackRoute = source(
      "src/app/api/teaching/operations/collaboration-invite-deliveries/route.ts",
    );
    const teachingOperationsRouteSmoke = source("scripts/teaching-operations-route-smoke.mjs");
    const externalStore = source(
      "src/lib/server/teaching-course-management-external-store.ts",
    );
    const releaseGate = source("scripts/production-e2e-release-gate.mjs");
    const acceptancePacket = source(
      "coordination/reports/2026-06-28-enterprise-live-acceptance-packet.md",
    );

    expect(releaseGate).toContain("teachingOperationsRouteSmokeSource");
    expect(releaseGate).toContain(
      "const requiredTeachingOperationsRouteSmokeProofs = extractConstStringArray",
    );
    expect(releaseGate).toContain("\"proves\"");
    for (const providerAuditProof of [
      "student-roster-provider-sync-audit-source-returned",
      "knowledge-index-provider-sync-audit-source-returned",
      "course-content-provider-publish-audit-source-returned",
      "course-export-provider-audit-source-returned",
      "grading-feedback-provider-audit-source-returned",
    ]) {
      expect(teachingOperationsRouteSmoke).toContain(providerAuditProof);
    }
    for (const providerAuditResult of [
      "studentRosterProviderSyncAuditSourceReturned",
      "knowledgeIndexProviderSyncAuditSourceReturned",
      "courseContentProviderPublishAuditSourceReturned",
      "courseExportProviderAuditSourceReturned",
      "gradingFeedbackProviderAuditSourceReturned",
    ]) {
      expect(teachingOperationsRouteSmoke).toContain(providerAuditResult);
      expect(releaseGate).toContain(providerAuditResult);
    }

    const productionRuntimeSections = [
      {
        path: "src/app/api/teaching/courses/route.ts",
        section: courseRoute.slice(courseRoute.indexOf("function isTeachingCourseApiProductionRuntime")),
      },
      {
        path: "src/app/api/teaching/courses/[courseId]/classes/route.ts",
        section: classRoute.slice(classRoute.indexOf("function isTeachingClassApiProductionRuntime")),
      },
      {
        path: "src/app/api/teaching/invite-codes/[code]/join/route.ts",
        section: inviteJoinRoute.slice(
          inviteJoinRoute.indexOf("function isTeachingInviteJoinProductionRuntime"),
        ),
      },
      {
        path: "src/app/api/teaching/classes/[classId]/memberships/[membershipId]/approve/route.ts",
        section: membershipApproveRoute.slice(
          membershipApproveRoute.indexOf("function isTeachingMembershipApprovalApiProductionRuntime"),
        ),
      },
    ];

    for (const { path, section } of productionRuntimeSections) {
      expect(section, path).toContain("env.VERCEL_ENV === \"production\"");
      expect(section, path).toContain("env.NODE_ENV === \"production\"");
      expect(section, path).toContain("env.UAIS_DEPLOYMENT_ENV === \"production\"");
    }

    expect(courseRoute).toContain("readUaisAuthenticatedTeacherSessionFromSignedCookies");
    expect(courseRoute).toContain("readAuthenticatedStudent");
    expect(courseRoute).toContain("teacher-role-required");
    expect(courseRoute).toContain("assertTeachingCourseManagementLocalJsonRuntimeAllowed");
    expect(courseRoute).toContain("assertProductionTeacherAiOwnershipPersistenceConfigured");
    expect(courseRoute).toContain("assertTeacherCourseCoverAssetAccess");
    expect(courseRoute).toContain("createTeachingCourseRecord");
    expect(courseRoute).toContain("rollbackTeachingCourseCreationAfterOwnershipFailure");
    expect(courseRoute).toContain("mergeTeacherAiOwnershipRecord");
    expect(courseRoute.indexOf("const authenticatedTeacher = readAuthenticatedTeacher")).toBeLessThan(
      courseRoute.indexOf("const body = await readJsonBody(request)"),
    );
    expect(courseRoute.indexOf("assertTeacherCourseCoverAssetAccess")).toBeLessThan(
      courseRoute.indexOf("const { course, receipt } = await createTeachingCourseRecord"),
    );
    expect(
      courseRoute.indexOf("const { course, receipt } = await createTeachingCourseRecord"),
    ).toBeLessThan(courseRoute.indexOf("ownershipReceipt = await mergeTeacherAiOwnershipRecord"));

    expect(classRoute).toContain("readUaisAuthenticatedTeacherSessionFromSignedCookies");
    expect(classRoute).toContain("readAuthenticatedStudent");
    expect(classRoute).toContain("teacher-role-required");
    expect(classRoute).toContain("assertTeachingCourseManagementLocalJsonRuntimeAllowed");
    expect(classRoute).toContain("authorizeTeachingClassCourseAccessBeforeBody");
    expect(classRoute).toContain("createTeachingClassRecord");
    expect(classRoute.indexOf("const access = await authorizeTeachingClassCourseAccessBeforeBody")).toBeLessThan(
      classRoute.indexOf("const body = await readJsonBody(request)"),
    );
    expect(classRoute.indexOf("const body = await readJsonBody(request)")).toBeLessThan(
      classRoute.indexOf("await createTeachingClassRecord"),
    );

    expect(inviteJoinRoute).toContain("getUaisAppSessionClaimsFromCookieString");
    expect(inviteJoinRoute).toContain("readUaisAuthenticatedTeacherSessionFromSignedCookies");
    expect(inviteJoinRoute).toContain("resolveUaisAppAuthProviderContract");
    expect(inviteJoinRoute).toContain("student-role-required");
    expect(inviteJoinRoute).toContain("!isSafeTeachingInviteStudentActorId(claims.sessionId)");
    expect(inviteJoinRoute).toContain(
      "readSafeTeachingInviteStudentDisplayName(claims.displayName)",
    );
    expect(inviteJoinRoute).toContain("assertTeachingCourseManagementLocalJsonRuntimeAllowed");
    expect(inviteJoinRoute).toContain("joinTeachingClassByInviteCode");
    expect(inviteJoinRoute).toContain("student-auth-provider-not-production-ready");
    expect(inviteJoinRoute.indexOf("const authenticatedTeacher = readAuthenticatedTeacher")).toBeLessThan(
      inviteJoinRoute.indexOf("authenticatedStudent = readAuthenticatedStudent"),
    );
    expect(inviteJoinRoute.indexOf("const authenticatedTeacher = readAuthenticatedTeacher")).toBeLessThan(
      inviteJoinRoute.indexOf("const courseManagementRepository = createUaisTeachingCourseManagementRepository"),
    );

    expect(membershipApproveRoute).toContain("readUaisAuthenticatedTeacherSessionFromSignedCookies");
    expect(membershipApproveRoute).toContain("readAuthenticatedStudent");
    expect(membershipApproveRoute).toContain("teacher-role-required");
    expect(membershipApproveRoute).toContain("assertTeachingCourseManagementLocalJsonRuntimeAllowed");
    expect(membershipApproveRoute).toContain("approveTeachingClassMembership");
    expect(membershipApproveRoute).toContain("teacher-course-ownership-required");

    expect(collaborationInviteDeliveryCallbackRoute).toContain(
      "UAIS_COLLABORATION_INVITE_EMAIL_CALLBACK_TOKEN",
    );
    expect(collaborationInviteDeliveryCallbackRoute).toContain("timingSafeEqual");
    expect(collaborationInviteDeliveryCallbackRoute).toContain(
      "assertTeachingCourseManagementLocalJsonRuntimeAllowed",
    );
    expect(collaborationInviteDeliveryCallbackRoute).toContain(
      "recordTeachingCollaborationInviteEmailDeliveryCallback",
    );
    expect(
      collaborationInviteDeliveryCallbackRoute.indexOf("if (!hasMatchingBearerToken"),
    ).toBeLessThan(
      collaborationInviteDeliveryCallbackRoute.indexOf("const body = await readCallbackBody"),
    );
    const callbackMutationSection = collaborationInviteDeliveryCallbackRoute.slice(
      collaborationInviteDeliveryCallbackRoute.indexOf("const courseManagementRepository"),
      collaborationInviteDeliveryCallbackRoute.indexOf("return jsonResponse(200"),
    );
    expect(
      callbackMutationSection.indexOf("assertTeachingCourseManagementLocalJsonRuntimeAllowed"),
    ).toBeLessThan(
      callbackMutationSection.indexOf("recordTeachingCollaborationInviteEmailDeliveryCallback"),
    );
    const callbackAuditSourceSanitizer = collaborationInviteDeliveryCallbackRoute.slice(
      collaborationInviteDeliveryCallbackRoute.indexOf("function sanitizeRequestSourceHeader"),
      collaborationInviteDeliveryCallbackRoute.indexOf("async function readCallbackBody"),
    );
    expect(callbackAuditSourceSanitizer).toContain("slice(0, 160)");
    expect(callbackAuditSourceSanitizer).toContain("/\\/Users\\/");
    expect(callbackAuditSourceSanitizer).toContain("secret|api[_-]?key|token");
    expect(callbackAuditSourceSanitizer).toContain("return \"redacted\"");
    expect(teachingOperationsRouteSmoke).toContain(
      "collaborationInviteDeliveryCallbackAuditProbeUserAgent",
    );
    expect(teachingOperationsRouteSmoke).toContain(
      "UAIS teaching operations route smoke /Users/redacted/secret-token callback",
    );
    const teachingCourseManagementRouteSmoke = source(
      "scripts/teaching-course-management-route-smoke.mjs",
    );
    for (const duplicateInviteNoSideEffectProof of [
      "duplicateStudentInviteJoinNoDuplicateSideEffects",
      "duplicate-student-invite-join-no-duplicate-side-effects",
    ]) {
      expect(teachingCourseManagementRouteSmoke).toContain(
        duplicateInviteNoSideEffectProof,
      );
      expect(releaseGate).toContain(duplicateInviteNoSideEffectProof);
      expect(acceptancePacket).toContain(duplicateInviteNoSideEffectProof);
    }
    for (const duplicateApprovalNoSideEffectProof of [
      "duplicateMembershipApprovalNoDuplicateSideEffects",
      "duplicate-membership-approval-no-duplicate-side-effects",
    ]) {
      expect(teachingCourseManagementRouteSmoke).toContain(
        duplicateApprovalNoSideEffectProof,
      );
      expect(releaseGate).toContain(duplicateApprovalNoSideEffectProof);
      expect(acceptancePacket).toContain(duplicateApprovalNoSideEffectProof);
    }
    expect(teachingOperationsRouteSmoke).toContain('expectedUserAgent: "redacted"');
    expect(teachingOperationsRouteSmoke).toContain(
      "unauthenticatedCollaborationInviteEmailBounceCallbackNoWriteSideEffects",
    );
    expect(releaseGate).toContain(
      "unauthenticatedCollaborationInviteEmailBounceCallbackNoWriteSideEffects",
    );
    for (const signedStudentCallbackProof of [
      "signedStudentCollaborationInviteEmailBounceCallbackDenied",
      "signedStudentCollaborationInviteEmailBounceCallbackTraceHeaderReturned",
      "signedStudentCollaborationInviteEmailBounceCallbackNoWriteSideEffects",
    ]) {
      expect(teachingOperationsRouteSmoke).toContain(signedStudentCallbackProof);
      expect(releaseGate).toContain(signedStudentCallbackProof);
      expect(acceptancePacket).toContain(signedStudentCallbackProof);
    }
    expect(teachingOperationsRouteSmoke).toContain(
      "trace-teaching-operations-route-smoke-collaboration-invite-bounce-student-denied",
    );
    for (const invalidTokenCallbackProof of [
      "invalidTokenCollaborationInviteEmailBounceCallbackDenied",
      "invalidTokenCollaborationInviteEmailBounceCallbackTraceHeaderReturned",
      "invalidTokenCollaborationInviteEmailBounceCallbackNoWriteSideEffects",
    ]) {
      expect(teachingOperationsRouteSmoke).toContain(invalidTokenCallbackProof);
      expect(releaseGate).toContain(invalidTokenCallbackProof);
      expect(acceptancePacket).toContain(invalidTokenCallbackProof);
    }
    expect(teachingOperationsRouteSmoke).toContain(
      "invalid-email-callback-token-with-32-chars",
    );
    expect(teachingOperationsRouteSmoke).toContain(
      "trace-teaching-operations-route-smoke-collaboration-invite-bounce-invalid-token-denied",
    );
    for (const unsafeCallbackProof of [
      "unsafeCollaborationInviteEmailBounceCallbackDenied",
      "unsafeCollaborationInviteEmailBounceCallbackTraceHeaderReturned",
      "unsafeCollaborationInviteEmailBounceCallbackNoWriteSideEffects",
    ]) {
      expect(teachingOperationsRouteSmoke).toContain(unsafeCallbackProof);
      expect(releaseGate).toContain(unsafeCallbackProof);
      expect(acceptancePacket).toContain(unsafeCallbackProof);
    }
    expect(teachingOperationsRouteSmoke).toContain("unsafe/../callback-delivery");
    expect(teachingOperationsRouteSmoke).toContain(
      "trace-teaching-operations-route-smoke-collaboration-invite-bounce-unsafe-denied",
    );
    expect(teachingOperationsRouteSmoke).toContain(
      "unauthenticatedRollbackNoWriteSideEffects",
    );
    expect(releaseGate).toContain("unauthenticatedRollbackNoWriteSideEffects");
    for (const signedStudentRollbackProof of [
      "signedStudentRollbackDenied",
      "signedStudentRollbackTraceHeaderReturned",
      "signedStudentRollbackNoWriteSideEffects",
    ]) {
      expect(teachingOperationsRouteSmoke).toContain(signedStudentRollbackProof);
      expect(releaseGate).toContain(signedStudentRollbackProof);
      expect(acceptancePacket).toContain(signedStudentRollbackProof);
    }
    expect(teachingOperationsRouteSmoke).toContain(
      "unauthenticatedAlertNotificationNoWriteSideEffects",
    );
    expect(releaseGate).toContain(
      "unauthenticatedAlertNotificationNoWriteSideEffects",
    );
    for (const signedStudentAlertProof of [
      "signedStudentAlertNotificationEnqueueDenied",
      "signedStudentAlertNotificationTraceHeaderReturned",
      "signedStudentAlertNotificationNoWriteSideEffects",
      "signedStudentAlertNotificationReadbackDenied",
      "signedStudentAlertNotificationReadbackTraceHeaderReturned",
      "signedStudentAlertSummaryReadbackDenied",
      "signedStudentAlertSummaryReadbackTraceHeaderReturned",
    ]) {
      expect(teachingOperationsRouteSmoke).toContain(signedStudentAlertProof);
      expect(releaseGate).toContain(signedStudentAlertProof);
      expect(acceptancePacket).toContain(signedStudentAlertProof);
    }
    for (const signedStudentAuditReadbackProof of [
      "signedStudentAuditReadbackDenied",
      "signedStudentAuditReadbackTraceHeaderReturned",
    ]) {
      expect(teachingOperationsRouteSmoke).toContain(signedStudentAuditReadbackProof);
      expect(releaseGate).toContain(signedStudentAuditReadbackProof);
      expect(acceptancePacket).toContain(signedStudentAuditReadbackProof);
    }
    for (const unsafeAppSessionProof of [
      "unsafeAppSessionPostDenied",
      "unsafeAppSessionPostTraceHeaderReturned",
      "unsafeAppSessionPostNoWriteSideEffects",
      "unsafeAppSessionAuditReadbackDenied",
      "unsafeAppSessionAuditReadbackTraceHeaderReturned",
    ]) {
      expect(teachingOperationsRouteSmoke).toContain(unsafeAppSessionProof);
      expect(releaseGate).toContain(unsafeAppSessionProof);
      expect(acceptancePacket).toContain(unsafeAppSessionProof);
    }
    for (const unsafeAppSessionContractProof of [
      "unsafe-app-session-post-denied",
      "unsafe-app-session-post-trace-header-returned",
      "unsafe-app-session-post-no-write-side-effects",
      "unsafe-app-session-audit-readback-denied",
      "unsafe-app-session-audit-readback-trace-header-returned",
    ]) {
      expect(teachingOperationsRouteSmoke).toContain(unsafeAppSessionContractProof);
    }
    for (const signedTeacherCourseIdProof of [
      "signedTeacherCourseIdRequired",
      "signedTeacherCourseIdRequiredNoWriteSideEffects",
    ]) {
      expect(teachingOperationsRouteSmoke).toContain(signedTeacherCourseIdProof);
      expect(releaseGate).toContain(signedTeacherCourseIdProof);
      expect(acceptancePacket).toContain(signedTeacherCourseIdProof);
    }
    for (const signedTeacherCourseIdContractProof of [
      "signed-teacher-course-id-required",
      "signed-teacher-course-id-required-no-write-side-effects",
    ]) {
      expect(teachingOperationsRouteSmoke).toContain(signedTeacherCourseIdContractProof);
    }
    expect(teachingOperationsRouteSmoke).toContain(
      "trace-teaching-operations-route-smoke-course-id-required",
    );
    expect(teachingOperationsRouteSmoke).toContain("createUnsafeStudentAppSessionCookie");
    expect(teachingOperationsRouteSmoke).toContain(
      "trace-teaching-operations-route-smoke-unsafe-app-session-denied",
    );
    for (const gradebookNoWriteProof of [
      "unauthenticatedGradebookReleaseNoWriteSideEffects",
      "unauthenticatedGradebookRollbackNoWriteSideEffects",
      "signedStudentGradebookReleaseNoWriteSideEffects",
      "signedStudentGradebookRollbackNoWriteSideEffects",
    ]) {
      expect(teachingOperationsRouteSmoke).toContain(gradebookNoWriteProof);
      expect(releaseGate).toContain(gradebookNoWriteProof);
      expect(acceptancePacket).toContain(gradebookNoWriteProof);
    }
    for (const gradebookProviderResult of [
      "gradebookProviderReleaseReturned",
      "gradebookProviderRollbackReturned",
    ]) {
      expect(teachingOperationsRouteSmoke).toContain(gradebookProviderResult);
      expect(releaseGate).toContain(gradebookProviderResult);
      expect(acceptancePacket).toContain(gradebookProviderResult);
    }
    for (const gradebookProviderProof of [
      "gradebook-provider-release-returned",
      "gradebook-provider-rollback-returned",
    ]) {
      expect(teachingOperationsRouteSmoke).toContain(gradebookProviderProof);
      expect(acceptancePacket).toContain(gradebookProviderProof);
    }
    for (const backupRestoreNoWriteProof of [
      "unauthenticatedBackupRestoreNoWriteSideEffects",
      "signedStudentBackupRestoreNoWriteSideEffects",
      "directBackupRestoreNoWriteSideEffects",
      "unsafeBackupRestoreNoWriteSideEffects",
    ]) {
      expect(teachingOperationsRouteSmoke).toContain(backupRestoreNoWriteProof);
      expect(releaseGate).toContain(backupRestoreNoWriteProof);
      expect(acceptancePacket).toContain(backupRestoreNoWriteProof);
    }
    for (const signedStudentBackupRestoreProof of [
      "signedStudentBackupRestoreDenied",
      "signedStudentBackupRestoreTraceHeaderReturned",
    ]) {
      expect(teachingOperationsRouteSmoke).toContain(signedStudentBackupRestoreProof);
      expect(releaseGate).toContain(signedStudentBackupRestoreProof);
      expect(acceptancePacket).toContain(signedStudentBackupRestoreProof);
    }
    for (const courseManagementNoWriteProof of [
      "unauthenticatedCourseCoverNoWriteSideEffects",
      "unauthenticatedCourseCreateNoWriteSideEffects",
      "unauthenticatedClassCreateNoWriteSideEffects",
    ]) {
      expect(teachingOperationsRouteSmoke).not.toContain(courseManagementNoWriteProof);
      expect(teachingCourseManagementRouteSmoke).toContain(courseManagementNoWriteProof);
      expect(releaseGate).toContain(courseManagementNoWriteProof);
      expect(acceptancePacket).toContain(courseManagementNoWriteProof);
    }
    expect(teachingCourseManagementRouteSmoke).toContain(
      "duplicateCourseCreateNoDuplicateSideEffects",
    );
    expect(releaseGate).toContain("duplicateCourseCreateNoDuplicateSideEffects");
    expect(acceptancePacket).toContain("duplicateCourseCreateNoDuplicateSideEffects");
    expect(teachingCourseManagementRouteSmoke).toContain(
      "duplicateClassCreateNoDuplicateSideEffects",
    );
    expect(releaseGate).toContain("duplicateClassCreateNoDuplicateSideEffects");
    expect(acceptancePacket).toContain("duplicateClassCreateNoDuplicateSideEffects");

    expect(externalStore).toContain("isUaisProductionRuntime(input.env)");
    expect(externalStore).toContain("productionDatabaseAdapter");
    expect(externalStore).toContain("revision");
    expect(externalStore).toContain("expectedRevision");
    expect(externalStore).toContain("External teaching course management snapshot changed; retry required.");

    expect(releaseGate).toContain("teaching-course-management-route-smoke-evidence-missing");
    expect(releaseGate).toContain("teaching-course-management-route-smoke");
    expect(releaseGate).toContain("/api/teaching/courses/{courseId}/classes");
    expect(releaseGate).toContain("/api/teaching/invite-codes/{code}/join");
    expect(releaseGate).toContain(
      "/api/teaching/classes/{classId}/memberships/{membershipId}/approve",
    );
  });

  it("keeps external storage smoke proving unauthorized ordinary teaching appends are denied without ledger writes", () => {
    const externalStorageSmoke = source("scripts/external-storage-smoke.mjs");
    const releaseGate = source("scripts/production-e2e-release-gate.mjs");
    const acceptancePacket = source(
      "coordination/reports/2026-06-28-enterprise-live-acceptance-packet.md",
    );

    for (const authDenialProof of [
      "s12-external-teaching-operations-unauthenticated-append-denied",
      "s12-external-teaching-operations-invalid-token-append-denied",
    ]) {
      expect(externalStorageSmoke).toContain(authDenialProof);
      expect(releaseGate).toContain(authDenialProof);
      expect(acceptancePacket).toContain(authDenialProof);
    }
    expect(externalStorageSmoke).toContain(
      "executeUnauthorizedTeachingOperationAppendSmokeCheck",
    );
    expect(externalStorageSmoke).toContain("appendResponseRedacted");
    expect(externalStorageSmoke).toContain("operationRecordAbsent");
    expect(externalStorageSmoke).toContain("auditEventAbsent");
    expect(externalStorageSmoke).toContain(
      "/teaching-operations/${encodeURIComponent(teacherId)}/append",
    );
    expect(externalStorageSmoke).toContain(
      "/teaching-operations/${encodeURIComponent(teacherId)}/audit",
    );
  });

  it("keeps ordinary teaching operation external appends serialized under concurrent writes", () => {
    const externalStorageService = source("scripts/external-storage-service.mjs");
    const nextExternalStorageService = source("src/lib/server/external-storage-route-service.ts");
    const externalStorageSmoke = source("scripts/external-storage-smoke.mjs");
    const releaseGate = source("scripts/production-e2e-release-gate.mjs");
    const orchestrator = source("scripts/production-e2e-orchestrator.mjs");
    const acceptancePacket = source(
      "coordination/reports/2026-06-28-enterprise-live-acceptance-packet.md",
    );
    const externalStorageServiceTest = source("tests/external-storage-service.test.ts");
    const concurrentAppendSmokeId =
      "s12-external-teaching-operations-concurrent-append-readback";

    for (const [label, serviceSource] of [
      ["reference service", externalStorageService],
      ["Next route service", nextExternalStorageService],
    ] as const) {
      const appendSection = sliceRequiredSection(
        serviceSource,
        "async function appendTeachingOperation",
        "function areTeachingOperationRecordsEquivalent",
      );

      expect(serviceSource, label).toContain("teachingOperationAppendWriteQueues");
      expect(serviceSource, label).toContain("runWithTeachingOperationAppendWriteLock");
      expect(appendSection, label).toContain("runWithTeachingOperationAppendWriteLock");
      expect(appendSection.indexOf("runWithTeachingOperationAppendWriteLock"), label).toBeLessThan(
        appendSection.indexOf("appendFile("),
      );
      expect(appendSection, label).toContain("appendSequence");
    }

    expect(externalStorageServiceTest).toContain(
      "serializes concurrent ordinary teaching operation appends without dropping ledger entries",
    );
    expect(externalStorageServiceTest).toContain("Promise.all(");
    expect(externalStorageServiceTest).toContain("recordCount: 2");
    expect(externalStorageServiceTest).toContain("operationRecordCount: 2");
    expect(externalStorageServiceTest).toContain("domainProjectionCount: 2");
    expect(externalStorageSmoke).toContain(concurrentAppendSmokeId);
    expect(externalStorageSmoke).toContain(
      "executeConcurrentTeachingOperationAppendSmokeCheck",
    );
    expect(externalStorageSmoke).toContain("appendSequencesDistinct");
    expect(externalStorageSmoke).toContain("domainProjectionsPresent");
    expect(releaseGate).toContain(concurrentAppendSmokeId);
    expect(releaseGate).toContain("teachingOperationsConcurrentAppendReadback");
    expect(orchestrator).toContain("ordinary-teaching-concurrent-append-readback");
    expect(orchestrator).toContain(
      "ordinary-teaching-concurrent-append-domain-projection-readback",
    );
    expect(acceptancePacket).toContain(concurrentAppendSmokeId);
  });

  it("keeps operation-detail browser smoke bound to app-auth readiness evidence", () => {
    const browserSmoke = source("scripts/teaching-operation-detail-browser-smoke.mjs");
    const releaseGate = source("scripts/production-e2e-release-gate.mjs");
    const orchestrator = source("scripts/production-e2e-orchestrator.mjs");
    const evidenceAudit = source("scripts/enterprise-live-evidence-audit.mjs");
    const acceptancePacket = source(
      "coordination/reports/2026-06-28-enterprise-live-acceptance-packet.md",
    );

    expect(browserSmoke).toContain("--app-auth-provider-readiness");
    expect(browserSmoke).toContain("appAuthProviderReadinessEvidence");
    expect(browserSmoke).toContain("app-auth-provider-readiness-evidence-missing");
    expect(orchestrator).toContain(
      "--app-auth-provider-readiness <app-auth-provider-readiness-evidence>",
    );
    expect(orchestrator).toContain("app-auth-provider-readiness-bound");
    expect(releaseGate).toContain(
      "teaching-operation-detail-browser-smoke-app-auth-readiness-binding-not-proven",
    );
    expect(releaseGate).toContain(
      "teaching-operation-detail-browser-smoke-app-auth-readiness-release-run-not-proven",
    );
    expect(evidenceAudit).toContain("appAuthProviderReadinessEvidence");
    expect(evidenceAudit).toContain("isTeachingOperationDetailBrowserAppAuthEvidenceProved");
    expect(acceptancePacket).toContain("appAuthProviderReadinessEvidence");
    expect(acceptancePacket).toContain("teacher-auth/app-auth bindings");
  });

  it("keeps generated course covers bound to durable course asset and course-management records", () => {
    const route = source("src/app/api/teaching/course-cover/route.ts");
    const assetsStore = source("src/lib/server/teaching-course-assets-store.ts");
    const assetsExternalStore = source("src/lib/server/teaching-course-assets-external-store.ts");
    const externalStorageService = source("scripts/external-storage-service.mjs");
    const nextExternalStorageService = source("src/lib/server/external-storage-route-service.ts");
    const routeSmoke = source("scripts/teaching-course-management-route-smoke.mjs");
    const browserSmoke = source("scripts/teaching-operation-detail-browser-smoke.mjs");
    const releaseGate = source("scripts/production-e2e-release-gate.mjs");
    const acceptancePacket = source(
      "coordination/reports/2026-06-28-enterprise-live-acceptance-packet.md",
    );
    const assetsProductionRuntimeSection = assetsStore.slice(
      assetsStore.indexOf("function isTeachingCourseAssetsProductionRuntime"),
    );

    expect(route).toContain("readAuthenticatedTeacher");
    expect(route).toContain("authorizeCourseCoverAccess");
    expect(route).toContain("assertProductionTeacherAiOwnershipAccessConfigured");
    expect(route).toContain("storeTeachingCourseCoverAsset");
    expect(route).toContain("maybeBindCourseCoverToExistingCourse");
    expect(route).toContain("assertProductionCourseCoverBindingPersistenceConfigured");
    expect(route).toContain("assetPersistence");
    expect(route).toContain("courseBindingReceipt");

    expect(route.indexOf("const access = await authorizeCourseCoverAccess")).toBeLessThan(
      route.indexOf("const client = qwenImageClientFactory"),
    );
    expect(route.indexOf("storeTeachingCourseCoverAsset")).toBeLessThan(
      route.indexOf("maybeBindCourseCoverToExistingCourse"),
    );

    expect(assetsStore).toContain("isTeachingCourseAssetsProductionRuntime(env)");
    expect(assetsProductionRuntimeSection).toContain("env.VERCEL_ENV === \"production\"");
    expect(assetsProductionRuntimeSection).toContain("env.NODE_ENV === \"production\"");
    expect(assetsProductionRuntimeSection).toContain(
      "env.UAIS_DEPLOYMENT_ENV === \"production\"",
    );
    expect(assetsStore).not.toContain(
      'env.NODE_ENV !== "production" && env.VERCEL_ENV !== "production"',
    );
    expect(assetsExternalStore).toContain("if (response.status === 404)");
    expect(assetsExternalStore).toContain("isUaisProductionRuntime(input.env)");
    expect(assetsExternalStore).toContain(
      "External teaching course cover asset read acknowledgement is missing production database adapter evidence.",
    );
    expect(externalStorageService).toContain(
      "assertProductionDatabaseAdapterReadyForSnapshotReadback(config)",
    );
    expect(nextExternalStorageService).toContain(
      "assertProductionDatabaseAdapterReadyForSnapshotReadback(config)",
    );
    expect(externalStorageService).toContain(
      "Production external storage snapshot readback requires ready managed database adapter proof.",
    );
    expect(nextExternalStorageService).toContain(
      "Production external storage snapshot readback requires ready managed database adapter proof.",
    );

    expect(routeSmoke).toContain("existingCourseCoverExternalAssetAuditReadbackReturned");
    expect(releaseGate).toContain("existingCourseCoverExternalAssetAuditReadbackReturned");
    expect(acceptancePacket).toContain("existingCourseCoverExternalAssetAuditReadbackReturned");
    expect(releaseGate).toContain("existing-course-cover-asset-audit-external-readback-returned");
    expect(routeSmoke).toContain("existingCourseCoverListedReadbackReturned");
    expect(routeSmoke).toContain("existing-course-cover-listed-readback-returned");
    expect(releaseGate).toContain("existingCourseCoverListedReadbackReturned");
    expect(releaseGate).toContain("existing-course-cover-listed-readback-returned");
    expect(acceptancePacket).toContain("existingCourseCoverListedReadbackReturned");
    expect(acceptancePacket).toContain("existing-course-cover-listed-readback-returned");
    expect(browserSmoke).toContain("verify-main-new-course-cover-asset-audit-gated");
    expect(browserSmoke).toContain("mainCourseCoverAssetAuditGated");
    expect(browserSmoke).toContain("waitForCourseCoverAssetAuditResponse");
    expect(browserSmoke).toContain("hasPersistedCourseCoverAssetAudit");
    expect(releaseGate).toContain("mainCourseCoverAssetAuditGated");
    expect(acceptancePacket).toContain("mainCourseCoverAssetAuditGated");
  });

  it("keeps main teaching course and class creation gated by persisted readback before local success", () => {
    const page = source("src/components/pages/teaching-page.tsx");
    const browserSmoke = source("scripts/teaching-operation-detail-browser-smoke.mjs");
    const releaseGate = source("scripts/production-e2e-release-gate.mjs");
    const acceptancePacket = source(
      "coordination/reports/2026-06-28-enterprise-live-acceptance-packet.md",
    );
    const createCourseSection = page.slice(
      page.indexOf("async function createCourseFromDraft"),
      page.indexOf("async function createClassForCourse"),
    );
    const createClassSection = page.slice(
      page.indexOf("async function createClassForCourse"),
      page.indexOf("async function approveClassMembership"),
    );

    expect(createCourseSection).toContain('await fetch("/api/teaching/courses"');
    expect(createCourseSection).toContain('method: "POST"');
    expect(createCourseSection).toContain("isMergedCourseOwnershipReceipt");
    expect(createCourseSection).toContain("isPersistedTeachingCourseCreateReceipt");
    expect(createCourseSection).toContain("const readback = await readPersistedTeachingCourseState()");
    expect(page).toContain("TEACHING_COURSE_CREATE_RECEIPT_MISSING_MESSAGE");
    expect(createCourseSection).toContain("TEACHING_COURSE_CREATE_READBACK_MISSING_MESSAGE");
    expect(createCourseSection).toContain("TEACHING_COURSE_CREATE_READBACK_MISMATCH_MESSAGE");
    expect(createCourseSection.indexOf("const readback = await readPersistedTeachingCourseState()")).toBeLessThan(
      createCourseSection.indexOf("applyPersistedTeachingCourseReadback(readback)"),
    );
    expect(createCourseSection.indexOf("applyPersistedTeachingCourseReadback(readback)")).toBeLessThan(
      createCourseSection.indexOf("setIsNewCourseOpen(false)"),
    );
    expect(createCourseSection).not.toContain("setCourseCards(");

    expect(createClassSection).toContain(
      'await fetch(`/api/teaching/courses/${courseId}/classes`',
    );
    expect(createClassSection).toContain('method: "POST"');
    expect(createClassSection).toContain("isPersistedTeachingClassCreateReceipt");
    expect(page).toContain("function isVerifiedTeachingCreateAuthSession");
    expect(page).toContain('typeof authSession?.sessionId === "string"');
    expect(page).toContain('typeof authSession.authenticatedAt === "string"');
    expect(page).toContain('typeof authSession.expiresAt === "string"');
    expect(createClassSection).toContain("const readback = await readPersistedTeachingCourseState()");
    expect(createClassSection).toContain("TEACHING_CLASS_CREATE_READBACK_MISSING_MESSAGE");
    expect(createClassSection).toContain("TEACHING_CLASS_CREATE_READBACK_MISMATCH_MESSAGE");
    expect(createClassSection.indexOf("const readback = await readPersistedTeachingCourseState()")).toBeLessThan(
      createClassSection.indexOf("applyPersistedTeachingCourseReadback(readback)"),
    );
    expect(createClassSection.indexOf("applyPersistedTeachingCourseReadback(readback)")).toBeLessThan(
      createClassSection.indexOf("setNewClassCourseId(undefined)"),
    );
    expect(createClassSection).not.toContain("setCourseClasses(");

    for (const createReceiptSessionResult of [
      "mainCourseCreateReceiptAuthSessionReturned",
      "mainClassCreateReceiptAuthSessionReturned",
      "mainInlineOperationReceiptAuthSessionReturned",
    ]) {
      expect(browserSmoke).toContain(createReceiptSessionResult);
      expect(releaseGate).toContain(createReceiptSessionResult);
      expect(acceptancePacket).toContain(createReceiptSessionResult);
    }
  });

  it("keeps AI workflow direct APIs signed even for contract-mode calls and generated downloads", () => {
    const signedAiRouteFiles = [
      "src/app/api/ai/chat/route.ts",
      "src/app/api/ai/voice-sample/route.ts",
      "src/app/api/ai/voice-clone/preflight/route.ts",
      "src/app/api/ai/voice-clone/status/route.ts",
      "src/app/api/ai/voice-clone/revoke/route.ts",
      "src/app/api/ai/ppt-narration/route.ts",
      "src/app/api/ai/ppt-narration/audio/[manifestId]/[audioId]/route.ts",
      "src/app/api/ai/ppt-narration/export/[manifestId]/route.ts",
    ];

    for (const routeFile of signedAiRouteFiles) {
      const route = source(routeFile);
      expect(route, routeFile).toContain("assertUaisAiAccess");
      expect(route, routeFile).toContain("requireSignedSession: true");
    }

    const contractModePostRouteOrders = [
      {
        routeFile: "src/app/api/ai/chat/route.ts",
        preBodyCall: "authorizeChatRequestBeforeBodyRead({",
        bodyRead: "const rawBody = await request.json()",
        resourceCall: "authorizeContractChatRequestBeforeValidation({",
        parseCall: "const body = parseChatRequest(rawBody)",
      },
      {
        routeFile: "src/app/api/ai/voice-sample/route.ts",
        preBodyCall: "authorizeVoiceSampleRequestBeforeBodyRead({",
        bodyRead: "const rawBody = await request.json()",
        resourceCall: "authorizeContractVoiceSampleRequestBeforeValidation({",
        parseCall: "const body = parseVoiceSampleBody(rawBody)",
      },
      {
        routeFile: "src/app/api/ai/voice-clone/preflight/route.ts",
        preBodyCall: "authorizeVoiceClonePreflightRequestBeforeBodyRead({",
        bodyRead: "const rawBody = await request.json()",
        resourceCall: "authorizeVoiceClonePreflightRequestBeforeValidation({",
        parseCall: "const body = parseVoiceClonePreflightBody(rawBody)",
      },
      {
        routeFile: "src/app/api/ai/voice-clone/status/route.ts",
        preBodyCall: "authorizeVoiceCloneStatusRequestBeforeBodyRead({",
        bodyRead: "const rawBody = await request.json()",
        resourceCall: "authorizeVoiceCloneStatusRequestBeforeValidation({",
        parseCall: "const body = parseVoiceCloneStatusBody(rawBody)",
      },
      {
        routeFile: "src/app/api/ai/ppt-narration/route.ts",
        preBodyCall: "authorizePptNarrationRequestBeforeBodyRead({",
        bodyRead: "const rawBody = await request.json()",
        resourceCall: "authorizePptNarrationRequestBeforeValidation({",
        parseCall: "const body = parsePptNarrationBody(rawBody)",
      },
    ];

    for (const {
      routeFile,
      preBodyCall,
      bodyRead,
      resourceCall,
      parseCall,
    } of contractModePostRouteOrders) {
      const route = source(routeFile);
      expect(route.indexOf(preBodyCall), routeFile).toBeLessThan(route.indexOf(bodyRead));
      expect(route.indexOf(resourceCall), routeFile).toBeLessThan(route.indexOf(parseCall));
    }

    const revokeRoute = source("src/app/api/ai/voice-clone/revoke/route.ts");
    expect(revokeRoute.indexOf("authorizeVoiceCloneRevokeRequestBeforeBodyRead({")).toBeLessThan(
      revokeRoute.indexOf("const body = parseVoiceCloneRevokeBody(await request.json())"),
    );

    const adminAiRouteFiles = [
      "src/app/api/ai/readiness/route.ts",
      "src/app/api/ai/smoke-plan/route.ts",
      "src/app/api/ai/voice-clone/lifecycle-audit/route.ts",
      "src/app/api/ai/voice-assets/retention-readiness/route.ts",
    ];

    for (const routeFile of adminAiRouteFiles) {
      const route = source(routeFile);
      expect(route, routeFile).toContain("assertUaisAiAdminAccess");
      expect(route, routeFile).toContain("requireSignedSession: true");
    }

    const readinessRoute = source("src/app/api/ai/readiness/route.ts");
    const readinessProductionRuntimeSection = readinessRoute.slice(
      readinessRoute.indexOf("function isReadinessProductionRuntime"),
    );
    expect(readinessRoute).toContain("target: isReadinessProductionRuntime(env)");
    expect(readinessProductionRuntimeSection).toContain("env.VERCEL_ENV === \"production\"");
    expect(readinessProductionRuntimeSection).toContain("env.NODE_ENV === \"production\"");
    expect(readinessProductionRuntimeSection).toContain(
      "env.UAIS_DEPLOYMENT_ENV === \"production\"",
    );
    expect(readinessRoute).not.toContain(
      'target: env.NODE_ENV === "production" ? "production" : "local"',
    );
  });

  it("keeps AI direct-call route-smoke probes synchronized with the production release gate", () => {
    const aiRouteSmoke = source("scripts/ai-route-smoke.mjs");
    const releaseGate = source("scripts/production-e2e-release-gate.mjs");
    const expectedSignedSessionProbes = [
      { route: "/api/ai/ppt-narration", method: "POST" },
      { route: "/api/ai/chat", method: "POST" },
      { route: "/api/ai/voice-sample", method: "POST" },
      { route: "/api/ai/voice-clone/preflight", method: "POST" },
      { route: "/api/ai/voice-clone/status", method: "POST" },
      { route: "/api/ai/voice-clone/revoke", method: "POST" },
      { route: "/api/ai/ppt-narration/export/{audioManifestId}", method: "GET" },
      { route: "/api/ai/ppt-narration/audio/{audioManifestId}/{audioId}", method: "GET" },
    ];
    const expectedTeacherCookieProbes = [
      {
        route: "/api/ai/teacher-ownership",
        method: "GET",
        expectedStatus: 401,
        reasonCode: "authenticated-session-required",
      },
      {
        route: "/api/ai/teacher-ppt-workflow",
        method: "GET",
        expectedStatus: 401,
        reasonCode: "authenticated-session-required",
      },
    ];
    const expectedAdminRouteProbes = [
      { route: "/api/ai/voice-assets/retention-readiness", method: "GET" },
      { route: "/api/ai/voice-clone/lifecycle-audit", method: "GET" },
      { route: "/api/ai/readiness", method: "GET" },
      { route: "/api/ai/smoke-plan", method: "GET" },
    ];

    const aiRouteSmokeDirectProbeSection = sliceRequiredSection(
      aiRouteSmoke,
      "const probes = [",
      "  const teacherCookieRouteProbes = [",
    );
    const releaseGateDirectProbeSection = sliceRequiredSection(
      releaseGate,
      "const requiredTeacherAiDirectCallBoundaryProbes = [",
      "const requiredTeacherAiTeacherCookieRouteProbes = [",
    );
    expect(extractRouteMethodPairs(aiRouteSmokeDirectProbeSection)).toEqual(
      expectedSignedSessionProbes,
    );
    expect(extractRouteMethodPairs(releaseGateDirectProbeSection)).toEqual(
      expectedSignedSessionProbes,
    );

    const aiRouteSmokeAdminRouteProbeSection = sliceRequiredSection(
      aiRouteSmoke,
      "const adminRouteProbes = [",
      "  const probeResults = await executeDirectCallDenialProbes",
    );
    const releaseGateAdminRouteProbeSection = sliceRequiredSection(
      releaseGate,
      "const requiredTeacherAiAdminRouteDirectCallProbes = [",
      "const requiredExternalStorageSmokeIds = [",
    );
    expect(extractRouteMethodPairs(aiRouteSmokeAdminRouteProbeSection)).toEqual(
      expectedAdminRouteProbes,
    );
    expect(extractRouteMethodPairs(releaseGateAdminRouteProbeSection)).toEqual(
      expectedAdminRouteProbes,
    );

    const aiRouteSmokeTeacherCookieProbeSection = sliceRequiredSection(
      aiRouteSmoke,
      "const teacherCookieRouteProbes = [",
      "  const adminRouteProbes = [",
    );
    const releaseGateTeacherCookieProbeSection = sliceRequiredSection(
      releaseGate,
      "const requiredTeacherAiTeacherCookieRouteProbes = [",
      "const requiredTeacherAiAdminRouteDirectCallProbes = [",
    );
    expect(extractDeniedProbeContracts(aiRouteSmokeTeacherCookieProbeSection)).toEqual(
      expectedTeacherCookieProbes,
    );
    expect(extractDeniedProbeContracts(releaseGateTeacherCookieProbeSection)).toEqual(
      expectedTeacherCookieProbes,
    );

    expect(releaseGate).toContain("deployment-route-smoke-direct-call-boundary-not-proven");
    expect(releaseGate).toContain("deployment-route-smoke-helper-auth-boundary-not-proven");
  });

  it("keeps AI ownership and teacher PPT workflow routes closed behind signed teacher auth", () => {
    const teacherScopedWorkflowRouteFiles = [
      "src/app/api/ai/teacher-ownership/route.ts",
      "src/app/api/ai/teacher-ppt-workflow/route.ts",
    ];

    for (const routeFile of teacherScopedWorkflowRouteFiles) {
      const route = source(routeFile);

      expect(route, routeFile).toContain("readUaisAuthenticatedTeacherSessionFromSignedCookies");
      expect(route, routeFile).toContain("authenticated-session-required");
      expect(route, routeFile).toContain("createRedaction()");
      expect(route.indexOf("const authenticatedSession = await getAuthenticatedTeacherSession")).toBeLessThan(
        route.indexOf("const ownership = await ownershipReader"),
      );
    }

    const teacherPptWorkflowRoute = source("src/app/api/ai/teacher-ppt-workflow/route.ts");
    const teachingPage = source("src/components/pages/teaching-page.tsx");
    const sessionRoute = source("src/app/api/ai/session/route.ts");
    const accessControl = source("src/lib/server/ai-access-control.ts");
    const aiRouteSmoke = source("scripts/ai-route-smoke.mjs");

    expect(teacherPptWorkflowRoute).toContain("assertUaisAiAccess");
    expect(teacherPptWorkflowRoute).toContain('action: "teacher-ppt-workflow-read"');
    expect(teacherPptWorkflowRoute).toContain("requireSignedSession: true");
    expect(teacherPptWorkflowRoute.indexOf("assertUaisAiAccess({")).toBeLessThan(
      teacherPptWorkflowRoute.indexOf("const ownership = await ownershipReader"),
    );
    expect(teachingPage).toContain('action: "teacher-ppt-workflow-read"');
    expect(teachingPage).toContain(
      'data-uais-workflow-session-actions="teacher-ppt-workflow-read',
    );
    expect(sessionRoute).toContain('"teacher-ppt-workflow-read"');
    expect(accessControl).toContain('| "teacher-ppt-workflow-read"');
    expect(aiRouteSmoke).toContain("readTeacherAiAccessHeadersFromSessionResponse");
    expect(aiRouteSmoke).toContain('check.id === "s22-teacher-ppt-workflow-route" && issuedTeacherAiAccessHeaders');
  });

  it("keeps learning AI guide provider calls closed behind app session and course access", () => {
    const route = source("src/app/api/learning/ai-guide/route.ts");
    const access = source("src/lib/server/learning-ai-guide-access.ts");

    expect(route).toContain("getUaisAppSessionUserFromCookieString");
    expect(route).toContain("createLearningAiGuideCourseContextRequiredAccessDecision");
    expect(route).toContain("authorizeLearningAiGuideCourseAccess");
    expect(access).toContain("course-context-required");

    expect(route.indexOf("const appSession = getUaisAppSessionUserFromCookieString")).toBeLessThan(
      route.indexOf("const body = parseLearningAiGuideRequest"),
    );
    expect(route.indexOf("const courseId = body.course?.courseId")).toBeLessThan(
      route.indexOf('if (body.mode === "multi-agent")'),
    );
    expect(route.indexOf("const access = await authorizeLearningAiGuideCourseAccess")).toBeLessThan(
      route.indexOf('if (body.mode === "multi-agent")'),
    );
    expect(route.indexOf("const access = await authorizeLearningAiGuideCourseAccess")).toBeLessThan(
      route.indexOf("const agent = learningAiGuideAgents"),
    );
  });

  it("keeps production gradebook release closed on configured external provider sync before persistence", () => {
    const route = source("src/app/api/teaching/gradebook-updates/[objectId]/release/route.ts");

    expect(route).toContain("Gradebook release provider is not configured.");
    expect(route).toContain("isTeachingOperationProductionRuntime(input.env)");
    expect(route).toContain("providerToken.length < 32");
    expect(route).toContain("readExternalGradebookProviderUrl");
    expect(route).toContain('url.protocol !== "https:"');
    expect(route).toContain("isDisallowedExternalGradebookProviderHost");
    expect(route).toContain('host === "localhost"');
    expect(route).toContain("octets[0] === 127");
    expect(route).toContain("octets[0] === 10");
    expect(route.indexOf("const providerRelease = await syncGradebookReleaseProvider")).toBeLessThan(
      route.indexOf("appendExternalTeachingOperation && externalAudit"),
    );
    expect(route.indexOf("const provider = input.env.UAIS_GRADEBOOK_RELEASE_PROVIDER")).toBeLessThan(
      route.indexOf("const response = await input.fetch"),
    );
  });

  it("keeps production gradebook release rollback closed on configured external provider sync before persistence", () => {
    const route = source("src/app/api/teaching/gradebook-updates/[objectId]/rollback/route.ts");

    expect(route).toContain("Gradebook release rollback provider is not configured.");
    expect(route).toContain("isTeachingOperationProductionRuntime(input.env)");
    expect(route).toContain("providerToken.length < 32");
    expect(route).toContain("readExternalGradebookProviderUrl");
    expect(route).toContain('url.protocol !== "https:"');
    expect(route).toContain("isDisallowedExternalGradebookProviderHost");
    expect(route).toContain('host === "localhost"');
    expect(route).toContain("octets[0] === 127");
    expect(route).toContain("octets[0] === 10");
    expect(
      route.indexOf("const providerRollback = await syncGradebookReleaseRollbackProvider"),
    ).toBeLessThan(route.indexOf("appendExternalTeachingOperation && externalAudit"));
    expect(route.indexOf("const provider = input.env.UAIS_GRADEBOOK_RELEASE_PROVIDER")).toBeLessThan(
      route.indexOf("const response = await input.fetch"),
    );
  });

  it("keeps production release evidence from accepting fixture-blocked provider generation as live mutation proof", () => {
    const releaseGate = source("scripts/production-e2e-release-gate.mjs");

    expect(releaseGate).toContain(
      'providerMutationPolicy.remoteMutations === "live-provider-approved"',
    );
    expect(releaseGate).toContain("providerMutationPolicy.liveProviderApproved === true");
    expect(releaseGate).toContain(
      "teacher-workflow-live-generation-provider-mutation-not-proven",
    );

    const liveGenerationSection = releaseGate.slice(
      releaseGate.indexOf("function evaluateTeacherWorkflowLiveGeneration"),
      releaseGate.indexOf("function readBrowserApiInterceptionPolicy"),
    );
    expect(liveGenerationSection).not.toContain(
      'providerMutationPolicy.remoteMutations === "fixture-blocked"',
    );
  });

  it("keeps manual PPT playback acceptance inside the same enterprise live evidence bundle", () => {
    const audit = source("scripts/enterprise-live-evidence-audit.mjs");
    const orchestrator = source("scripts/production-e2e-orchestrator.mjs");
    const releaseGate = source("scripts/production-e2e-release-gate.mjs");

    expect(audit).toContain('"ppt-manual-playback-acceptance"');
    expect(audit).toContain('"ppt-manual-playback-acceptance": "accepted"');
    expect(audit).toContain('"ppt-manual-playback-acceptance": "record"');
    expect(orchestrator).toContain(
      "ppt-manual-playback-acceptance-production-live.json",
    );
    expect(releaseGate).toContain("acceptedTargetModes");
  });
});
