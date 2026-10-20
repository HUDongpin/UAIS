const CLASS_ROSTER_PREFIX = "uais-class-roster-";

export function getClassRosterFragmentId(classId: string) {
  return `${CLASS_ROSTER_PREFIX}${classId}`;
}

export function getClassRosterHref(classId: string) {
  return `/teaching#${encodeURIComponent(getClassRosterFragmentId(classId))}`;
}

export function hasClassRosterFragment() {
  return typeof window !== "undefined" &&
    window.location.hash.startsWith(`#${CLASS_ROSTER_PREFIX}`) &&
    window.location.hash.length > CLASS_ROSTER_PREFIX.length + 1;
}

export function noClassRosterFragment() {
  return false;
}

export function subscribeClassRosterFragment(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener("popstate", onChange);
  };
}

export function clearClassRosterFragment() {
  if (!hasClassRosterFragment()) return;
  window.history.replaceState(
    window.history.state,
    "",
    window.location.pathname + window.location.search,
  );
  window.dispatchEvent(new Event("hashchange"));
}

/** Reveal an inline roster without remounting the teaching page or losing its state. */
export function openSamePageClassRoster(href: string) {
  if (typeof window === "undefined" || window.location.pathname !== "/teaching") {
    return false;
  }
  const target = new URL(href, window.location.origin);
  if (
    target.origin !== window.location.origin ||
    target.pathname !== "/teaching" ||
    !target.hash.startsWith(`#${CLASS_ROSTER_PREFIX}`) ||
    target.hash.length <= CLASS_ROSTER_PREFIX.length + 1
  ) {
    return false;
  }
  if (window.location.hash !== target.hash) {
    window.history.pushState(
      window.history.state,
      "",
      window.location.pathname + window.location.search + target.hash,
    );
  }
  // pushState does not emit hashchange, and selecting the same notification again
  // should still return focus to its roster.
  window.dispatchEvent(new Event("hashchange"));
  return true;
}
