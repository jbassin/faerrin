// Parsing of Craig recording filenames, ported faithfully from file_data.py so
// per-user output names match the Python pipeline exactly.
//
// Player track stems look like `<idx>-<discordid>` where the id may itself
// contain underscores, e.g.:
//   "1-miked6187"  -> user "miked6187", index "0"
//   "5-tanner_kn"  -> user "tanner",    index "kn"
//   "2-iiri___"    -> user "iiri__",    index ""
// (The last `_`-segment is treated as the index; everything before it is the user.)

/** Player track user id from a file stem (filename without extension). */
export function username(fileStem: string): string {
  const split = fileStem.split("-")
  if (split.length !== 2) return ""

  const parts = split[1]!.split("_")
  if (parts.length === 1) return parts[0]!

  return parts.slice(0, parts.length - 1).join("_")
}

/** Track index from a file stem ("0" when there's no `_`-suffix). */
export function index(fileStem: string): string {
  const split = fileStem.split("-")
  if (split.length !== 2) return ""

  const parts = split[1]!.split("_")
  if (parts.length === 1) return "0"

  return parts[parts.length - 1]!
}

/** Session date from a zip stem (the 3rd `_`-separated field of a 4-field name). */
export function date(fileStem: string): string {
  const split = fileStem.split("_")
  if (split.length !== 4) return ""

  return split[2]!
}
