"use client";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();
export const signInWithGitHub = (next = "/") => authClient.signIn.social({ provider: "github", callbackURL: next });
export const signOut = () => authClient.signOut();
