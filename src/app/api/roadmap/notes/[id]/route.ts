import { json, withStore } from "@/lib/roadmap-api";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withStore(request, async (store) => {
    const { id } = await params;
    await store.deleteNote(id);
    return json({ ok: true });
  });
}
