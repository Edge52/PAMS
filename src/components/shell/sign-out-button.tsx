"use client";
import { forgetKeptCopies } from "@/lib/offline/store";

/** The sign-out button. Also forgets the jobs kept on this phone for offline use (wave 39). */
export function SignOutButton() {
  return (
    <button type="submit" onClick={() => { void forgetKeptCopies(); }} className="block w-full rounded-[var(--radius-control)] px-3 py-2 text-left text-sm hover:bg-sunken">Sign out</button>
  );
}
