"use client";
import { signInWithGitHub } from "@/lib/auth-client";

export function SignInButton({ next = "/", label = "Sign in with GitHub" }: { next?: string; label?: string }) {
  return <button type="button" className="btn w-fit" onClick={() => signInWithGitHub(next)}>{label}</button>;
}
