import { store } from "@/lib/store";
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (id) { const f = await store.getFinding(id); const items = f ? (await Promise.all(f.items.map((i) => store.getItem(i)))).filter(Boolean) : []; return Response.json({ finding: f, items }); }
  return Response.json({ findings: await store.listFindings() });
}
