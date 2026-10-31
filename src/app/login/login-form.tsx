"use client";
import { useRef } from "react";
import { Field, Input } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { signIn } from "./actions";

export function LoginForm({ next, demo }: { next: string; demo: { email: string; name: string; role: string }[] }) {
  const email = useRef<HTMLInputElement>(null), password = useRef<HTMLInputElement>(null);
  return (
    <>
      <ActionForm action={signIn} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        <Field label="Email"><Input ref={email} type="email" name="email" autoComplete="username" required autoFocus /></Field>
        <Field label="Password"><Input ref={password} type="password" name="password" autoComplete="current-password" required /></Field>
        <SubmitButton className="w-full" pendingLabel="Signing in…">Sign in</SubmitButton>
      </ActionForm>
      {demo.length > 0 && (
        <div className="mt-6 border-t border-line pt-4">
          <p className="mb-2 text-sm font-semibold">Demo accounts <span className="font-normal text-muted">(password demo1234)</span></p>
          <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {demo.map((d) => (
              <li key={d.email}>
                <button type="button" className="w-full rounded-[var(--radius-control)] px-2 py-1 text-left text-sm hover:bg-sunken"
                  onClick={() => { if (email.current) email.current.value = d.email; if (password.current) password.current.value = "demo1234"; }}>
                  <span className="block font-semibold">{d.role}</span>
                  <span className="block text-xs text-muted">{d.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
