"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { actionError } from "@/lib/api";
import { createLead, updateLead } from "@/lib/leads/repo";
import { leadInput, leadUpdate } from "@/lib/leads/schema";
import { requireMember } from "@/lib/tenant";

export type LeadFormState = { error?: string };

export async function createLeadAction(_prev: LeadFormState, form: FormData): Promise<LeadFormState> {
  let id: string;
  try {
    const me = await requireMember({ write: true });
    const input = leadInput.parse(Object.fromEntries(form));
    id = await me.db((db) => createLead(db, input, me.userId));
  } catch (err) {
    return { error: actionError(err) };
  }
  revalidatePath("/leads");
  redirect(`/leads/${id}`);
}

/** Stage, status or consent change from the lead page. The database stops cadences and queues erasure as needed. */
export async function updateLeadAction(id: string, form: FormData): Promise<void> {
  if (!z.uuid().safeParse(id).success) return;
  const me = await requireMember({ write: true });
  const patch = leadUpdate.parse(Object.fromEntries([...form].filter(([, v]) => v !== "")));
  await me.db((db) => updateLead(db, id, patch));
  revalidatePath(`/leads/${id}`);
  revalidatePath("/leads");
  revalidatePath("/pipeline");
}
