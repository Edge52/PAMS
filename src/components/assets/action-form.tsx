"use client";
/**
 * The assets module's ActionForm is the shared one (audit U2): same validation messages, field errors and confirm
 * dialog everywhere. Asset actions return { error, ok }; the shared form reads that shape too. Messages stay at the
 * top of asset forms, as before.
 */
import type { ComponentProps } from "react";
import { ActionForm as SharedActionForm } from "@/components/ui/action-form";

export function ActionForm(props: Omit<ComponentProps<typeof SharedActionForm>, "messagesAt">) {
  return <SharedActionForm messagesAt="top" {...props} />;
}
