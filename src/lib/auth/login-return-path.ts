// The sign-in handoff every auth dead-end in the app shares.
//
// A return path only travels through `/login?from=` if it is same-origin and
// relative: it must start with a single slash and carry no scheme, so neither
// `//evil.example` nor `https://evil.example` can ride the sign-in handoff. The
// server applies the same rule again before it will redirect anywhere, and the
// login page reads the param back as `from`.
//
// It lives here rather than beside the course plaza because the playback stage,
// the chatroom notices and the student dashboard all have to send an expired
// session to the same place, with the same guard.

export function isSafeLoginReturnPath(value: string) {
  return (
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)
  );
}

export function createLoginHandoffHref(returnPath: string) {
  if (!isSafeLoginReturnPath(returnPath)) {
    return "/login";
  }
  return `/login?from=${encodeURIComponent(returnPath)}`;
}

// The learner workspace return path, rebuilt from the props the route was
// rendered with rather than from `window.location`: the href has to be identical
// on the server and on the first client render, or the page hydrates with a
// mismatch on exactly the surface that is already failing.
export function createLearningReturnPath({
  courseId,
  classId,
}: {
  courseId?: string;
  classId?: string;
} = {}) {
  const params = new URLSearchParams();
  if (courseId) {
    params.set("courseId", courseId);
  }
  if (classId) {
    params.set("classId", classId);
  }
  const query = params.toString();
  return query ? `/learning?${query}` : "/learning";
}
