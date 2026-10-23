/**
 * Type-to-narrow for the iPad's list of names: what someone types is matched against the start of each word of a name, so
 * "pri" finds Priya Rao, "rao" finds Priya Rao and Dev Rao, and "priya r" finds Priya Rao. Capital letters, accents and
 * extra spaces do not matter. Nothing typed shows everyone in the list.
 */

const plain = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function nameMatches(name: string, typed: string): boolean {
  const wanted = plain(typed);
  if (wanted === "") return true;
  const full = plain(name);
  // The whole typed text starts the name, or starts any word of it and continues through the words after it.
  const words = full.split(" ");
  return words.some((_, i) => words.slice(i).join(" ").startsWith(wanted));
}
