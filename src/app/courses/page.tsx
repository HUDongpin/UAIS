import { CoursePlazaPage } from "@/components/pages/course-plaza-page";

type CoursesRouteSearchParams = Promise<{
  invite?: string | string[] | undefined;
}>;

function getFirstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Page({
  searchParams,
}: {
  searchParams?: CoursesRouteSearchParams;
} = {}) {
  const query = searchParams ? await searchParams : {};

  return <CoursePlazaPage inviteParam={getFirstQueryValue(query.invite)} />;
}
