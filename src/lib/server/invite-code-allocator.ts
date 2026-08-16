import { randomInt } from "node:crypto";

// The one place an invite code is drawn. Both stores that mint codes - the
// course-management class allocator and the teaching-operations invite action -
// call this, so neither can drift back into a guessable sequence on its own.

// How many random codes to draw before giving up. The namespace is 90 million
// wide, so a deployment would need tens of millions of live classes before a
// single draw were likely to collide; 32 draws is a bound on the loop, not a
// number the allocator is expected to approach.
export const inviteCodeAllocationAttempts = 32;

// Codes are drawn at random, not counted upwards from a fixed seed.
//
// A sequential allocator makes every code in the deployment guessable from any
// single code a student has ever seen: the next class to be created gets the
// next number. A code is the only credential the join route asks for, so that
// is an enumeration of every class in the deployment. `randomInt` is uniform
// over the range (it rejection-samples internally), and the draw is
// rejection-sampled again here against the codes the caller already knows.
// Returns `undefined` when the draws are exhausted, so each caller can answer
// with its own store's error type.
export function drawUnusedInviteCode(usedInviteCodes: Set<string>) {
  for (let attempt = 0; attempt < inviteCodeAllocationAttempts; attempt += 1) {
    // 10000000..99999999: always eight digits, never a leading zero that a form
    // or a spreadsheet could silently eat.
    const invitationCode = String(randomInt(10_000_000, 100_000_000));
    if (!usedInviteCodes.has(invitationCode)) {
      return invitationCode;
    }
  }

  return undefined;
}
