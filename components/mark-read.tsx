"use client";
// Marks an assessment as read for the signed-in user once the case page is open.
import { useEffect } from "react";

export function MarkRead({ assessmentId }: { assessmentId: string }) {
  useEffect(() => { fetch("/api/notifications/read", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ assessment: assessmentId }) }).catch(() => {}); }, [assessmentId]);
  return null;
}
