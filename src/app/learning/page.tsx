import { LearningPage } from "@/components/pages/learning-page";

type LearningRouteSearchParams = Promise<{
  courseId?: string | string[] | undefined;
  classId?: string | string[] | undefined;
}>;

function getFirstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Page({
  searchParams,
}: {
  searchParams?: LearningRouteSearchParams;
} = {}) {
  const query = searchParams ? await searchParams : {};

  return (
    <LearningPage
      initialCourseId={getFirstQueryValue(query.courseId)}
      initialClassId={getFirstQueryValue(query.classId)}
    />
  );
}
