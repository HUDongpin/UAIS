import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readProjectFile(path: string) {
  return readFileSync(join(root, path), "utf8");
}

function listSourceFiles(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((entry) => {
    const relativePath = `${dir}/${entry}`;
    if (statSync(join(root, relativePath)).isDirectory()) {
      return listSourceFiles(relativePath);
    }
    return /\.tsx?$/.test(entry) ? [relativePath] : [];
  });
}

// The three heaviest routes were originally placed behind client-owned
// `next/dynamic` shells to keep their page modules out of the route's first
// client bundle. That baseline was reverted on 2026-08-09 because it stopped
// those pages hydrating at all: the server-rendered markup arrived intact and
// then never received a single event handler, silently and with no console
// error. Measured on a production build, `/learning` came up with 9 of 37
// interactive elements hydrated — everything outside the boundary, nothing
// inside it — and clicking "New Course" on `/teaching` did nothing.
//
// Both mechanisms that reproduce it wrap the page body in a Suspense boundary:
// `next/dynamic`'s `loading` option (which sets
// `hasSuspenseBoundary = !opts.ssr || !!opts.loading`) and the route-segment
// `loading.tsx` convention. Removing only the first while adding the second
// keeps the bug, which is why both are guarded below. `/courses` and `/login`
// never had either and have always hydrated.
describe("B-19/B-20 performance and accessibility baseline", () => {
  const shellRoutes = [
    { path: "src/app/teaching/page.tsx", module: "@/components/pages/teaching-page", element: "<TeachingPage />" },
    { path: "src/app/learning/page.tsx", module: "@/components/pages/learning-page", element: "<LearningPage" },
    {
      path: "src/app/learning/chatroom/page.tsx",
      module: "@/components/pages/learning-page-chatroom",
      element: "<LearningChatroomPage />",
    },
  ];

  it("loads the heaviest client pages through their route's own client bundle", () => {
    shellRoutes.forEach((route) => {
      const source = readProjectFile(route.path);
      expect(source, route.path).toContain(`from "${route.module}"`);
      expect(source, route.path).toContain(route.element);
    });
  });

  it("keeps Suspense boundaries off the page body on the routes that regressed", () => {
    const lazyOffenders = listSourceFiles("src").filter((path) =>
      /from "next\/dynamic"/.test(readProjectFile(path)),
    );
    expect(lazyOffenders).toEqual([]);

    // A `loading.tsx` beside any of these routes reintroduces the same boundary
    // through the file convention rather than through next/dynamic.
    const segmentOffenders = shellRoutes
      .map((route) => route.path.replace(/page\.tsx$/, "loading.tsx"))
      .filter((path) => existsSync(join(root, path)));
    expect(segmentOffenders).toEqual([]);
  });

  it("keeps route announcements specific", () => {
    const teachingRoute = readProjectFile("src/app/teaching/page.tsx");
    const learningRoute = readProjectFile("src/app/learning/page.tsx");
    const chatroomRoute = readProjectFile("src/app/learning/chatroom/page.tsx");
    const baseline = readProjectFile("docs/performance-accessibility-baseline.md");

    expect(teachingRoute).toContain("generateMetadata");
    expect(teachingRoute).toContain("My Teaching | UAIS");
    expect(learningRoute).toContain("generateMetadata");
    expect(learningRoute).toContain("My Learning | UAIS");
    expect(chatroomRoute).toContain("generateMetadata");
    expect(chatroomRoute).toContain("Human-AI Chatroom | UAIS");
    expect(baseline).toContain("Lighthouse");
    expect(baseline).toContain("hydrated");
  });
});
