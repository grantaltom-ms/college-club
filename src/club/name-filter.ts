/**
 * Type-to-narrow for the iPad's list of names: what someone types is matched against the start of each word of a name, so
 * "pri" finds Priya Rao, "rao" finds Priya Rao and Dev Rao, and "priya r" finds Priya Rao. Capital letters, accents and
 * extra spaces do not matter. Nothing typed shows everyone in the list.
 */

// Letters and digits from any alphabet are kept (a name written in Chinese or Cyrillic is a name, not "nothing typed"); accents are
// dropped, and any other mark or punctuation becomes a space. Typed text with no letter or digit in it at all is "nothing typed".
const plain = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s'-]/gu, " ")
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
