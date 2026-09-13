const MAX_LENGTH = 64;

/** "Exam Prep & Review" -> "exam-prep-review". Returns `fallback` if nothing usable is left. */
export function slugify(text, fallback) {
  const slug = String(text)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, MAX_LENGTH)
    .replace(/-+$/, '');
  return slug || fallback;
}

/** Slugs for a list of names, numbered so no two collide ("plan", "plan-2"). */
export function uniqueSlugs(names, fallbackPrefix) {
  const taken = new Set();
  return names.map((name, index) => {
    const base = slugify(name, `${fallbackPrefix}-${index + 1}`);
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
    taken.add(slug);
    return slug;
  });
}
