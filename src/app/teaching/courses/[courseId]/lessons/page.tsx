import {TeachingCourseLessonsPage} from "@/components/pages/teaching-course-lessons-page";
export default async function Page({params}:{params:Promise<{courseId:string}>}){const {courseId}=await params;return <TeachingCourseLessonsPage courseId={courseId}/>;}
