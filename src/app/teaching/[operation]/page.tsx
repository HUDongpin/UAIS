import { notFound } from "next/navigation";
import { TeachingOperationPage } from "@/components/teaching/teaching-operation-page";
import {
  TEACHING_OPERATION_IDS,
  isTeachingOperationId,
} from "@/components/teaching/teaching-operation-data";

type TeachingOperationRouteProps = {
  params: Promise<{
    operation: string;
  }>;
  searchParams: Promise<{
    action?: string | string[];
    course?: string | string[];
    // `createTeachingClassActionHref` has always emitted `class`, but this type
    // declared only `action` and `course`, so the class a teacher clicked through
    // from was silently dropped and the page opened course-scoped instead.
    class?: string | string[];
  }>;
};

export function generateStaticParams() {
  return TEACHING_OPERATION_IDS.map((operation) => ({ operation }));
}

export default async function Page({ params, searchParams }: TeachingOperationRouteProps) {
  const { operation } = await params;

  if (!isTeachingOperationId(operation)) {
    notFound();
  }

  const query = await searchParams;

  return (
    <TeachingOperationPage
      action={firstQueryValue(query.action)}
      operationId={operation}
      selectedClassId={firstQueryValue(query.class)}
      selectedCourseId={firstQueryValue(query.course)}
    />
  );
}

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
