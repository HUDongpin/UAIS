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
      selectedCourseId={firstQueryValue(query.course)}
    />
  );
}

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
