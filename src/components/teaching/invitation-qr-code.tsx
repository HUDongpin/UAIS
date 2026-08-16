"use client";

// A real, scannable QR code for a class invite link (plan E9).
//
// What stood here before was a hash pattern: four finder squares and a field of
// modules seeded from the invite code, with an aria-label calling itself a QR
// code. It could not be scanned by anything, which meant the one instruction the
// invitation dialog gave students - point a camera at this - was the one path
// that did not work.
//
// The encoder is `uqr` (MIT, unjs), pinned exactly in package.json. It is a
// dependency rather than a vendored copy because a QR encoder is a spec, not a
// preference: Reed-Solomon, mask selection and version choice are all places
// where "close enough" produces a code that scans on one phone and not the next.
//
// The QR carries an ABSOLUTE url, because a camera app has no origin to resolve
// `/courses?invite=CODE` against. The origin can only come from the browser, so
// the server render (and the hydrating client render with it) shows a placeholder
// and the grid appears once the real origin is readable. Neither side invents one.

import { useSyncExternalStore } from "react";
import { encode } from "uqr";
import type { Locale } from "@/i18n/copy";

// The origin is an external value that never changes for the life of the page, so
// the subscription is a no-op and only the two snapshots matter: the server (and
// the hydrating client render) sees `undefined`, and every render after hydration
// sees the real origin. Reading it in an effect would set state during commit and
// cascade a render for a value that cannot change.
const subscribeToOrigin = () => () => {};
const readClientOrigin = () => window.location.origin;
const readServerOrigin = () => undefined;

export function useInviteJoinOrigin() {
  return useSyncExternalStore(subscribeToOrigin, readClientOrigin, readServerOrigin);
}

// Same shape as the chatroom share link: the caller's own origin, trailing slash
// trimmed, plus the app-relative join path.
export function createAbsoluteInviteJoinUrl(joinPath: string, origin: string) {
  return `${origin.replace(/\/$/, "")}${joinPath}`;
}

export function InvitationQrCode({
  invitationCode,
  joinUrl,
  locale,
  variant = "dialog",
}: {
  invitationCode: string;
  // App-relative join path (`/courses?invite=CODE`); the absolute url scanned by
  // a camera is this resolved against the browser's own origin.
  joinUrl: string;
  locale: Locale;
  variant?: "dialog" | "inline";
}) {
  const origin = useInviteJoinOrigin();
  const absoluteJoinUrl = origin ? createAbsoluteInviteJoinUrl(joinUrl, origin) : undefined;
  const label = absoluteJoinUrl
    ? locale === "zh-CN"
      ? `邀请码 ${invitationCode} 的加入二维码，扫码后打开 ${absoluteJoinUrl}`
      : `Scannable join QR code for invite code ${invitationCode}, opening ${absoluteJoinUrl}`
    : locale === "zh-CN"
      ? `正在生成邀请码 ${invitationCode} 的加入二维码`
      : `Preparing the join QR code for invite code ${invitationCode}`;

  if (!absoluteJoinUrl) {
    return (
      <div
        role="img"
        aria-label={label}
        {...(variant === "inline"
          ? { "data-uais-inline-invitation-qr-pending": invitationCode }
          : { "data-uais-class-invitation-qr-pending": invitationCode })}
        className="mx-auto aspect-square w-full max-w-[560px] rounded-lg bg-[var(--surface-soft)]"
      />
    );
  }

  const qr = encode(absoluteJoinUrl, { ecc: "M", border: 2 });

  return (
    <svg
      role="img"
      aria-label={label}
      // Same data hooks the seeded pattern published, so the contract the rest of
      // the app and its tests address the QR by is unchanged; what changed is that
      // the modules now encode the join url instead of a hash of the code.
      {...(variant === "inline"
        ? { "data-uais-inline-invitation-qr": invitationCode }
        : { "data-uais-class-invitation-qr": invitationCode })}
      data-uais-invitation-qr-modules={qr.size}
      data-uais-invitation-qr-target={absoluteJoinUrl}
      viewBox={`0 0 ${qr.size} ${qr.size}`}
      shapeRendering="crispEdges"
      className="mx-auto block aspect-square h-auto w-full max-w-[560px] bg-white"
    >
      <rect width={qr.size} height={qr.size} fill="#ffffff" />
      {qr.data.map((row, rowIndex) =>
        row.map((isDark, columnIndex) =>
          isDark ? (
            <rect
              key={`${rowIndex}-${columnIndex}`}
              x={columnIndex}
              y={rowIndex}
              width={1}
              height={1}
              fill="#000000"
            />
          ) : null,
        ),
      )}
    </svg>
  );
}
