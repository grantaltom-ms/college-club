import { parseNote } from "@/lib/roadmap";
import { json, readBody, withStore } from "@/lib/roadmap-api";

/** Add a note to an item or subitem. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withStore(request, async (store) => {
    const { id } = await params;
    const read = await readBody(request);
    if ("response" in read) return read.response;
    const note = parseNote(read.body);
    if (!note.ok) return json({ error: note.error }, 400);
    return json({ note: await store.addNote(id, note.value) }, 201);
  });
}
