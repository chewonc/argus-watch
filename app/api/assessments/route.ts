import { store } from "@/lib/store";
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (id) return Response.json({ assessment: await store.getAssessment(id) });
  return Response.json({ assessments: await store.listAssessments(200) });
}
