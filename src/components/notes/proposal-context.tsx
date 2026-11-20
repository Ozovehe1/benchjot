"use client";
// Applying a change the Assistant proposed to another note (propose_change). Only the user's tap does
// it: the note screen provides how (it owns note writes); the Assistant panel only shows the button.
import { createContext, useContext } from "react";
import type { NoteProposal } from "@/lib/ai/agent";

/** "applied", or "already" when the note holds that text already (a second tap changes nothing). */
export type ApplyProposal = (p: NoteProposal) => Promise<"applied" | "already">;

const Ctx = createContext<ApplyProposal | null>(null);
export const ProposalProvider = Ctx.Provider;
export const useApplyProposal = () => useContext(Ctx);
