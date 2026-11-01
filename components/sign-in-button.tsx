"use client";
import { signInWithGitHub } from "@/lib/auth-client";

export function SignInButton({ next = "/" }: { next?: string }) {
  return <button type="button" className="btn w-fit" onClick={() => signInWithGitHub(next)}>Sign in with GitHub</button>;
}
