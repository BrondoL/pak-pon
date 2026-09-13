/**
 * Label tampilan untuk `<Select>`.
 *
 * ⚠️ `Select.Value` di fork base-ui repo ini **tidak** membaca teks dari
 * `<SelectItem>` yang dirender. Ia mencari label lewat prop `items` di
 * `Select.Root`; kalau prop itu tidak diberikan, ia jatuh ke
 * `serializeValue(value)` — alias mencetak nilainya mentah-mentah
 * (`__none__`, uuid, `pending_review`).
 *
 * Jadi setiap `<SelectValue>` yang nilainya bukan teks yang layak dibaca
 * manusia WAJIB memakai bentuk fungsi: `<SelectValue>{(v) => ...}</SelectValue>`.
 * Helper di sini yang memetakannya, supaya bisa diuji tanpa merender apa pun.
 */

/** Nilai sentinel "Tanpa role" — base-ui Select tidak menerima value string kosong. */
export const NO_ROLE = '__none__';

export type RoleOption = { id: string; name: string };

/**
 * Nama role untuk sebuah nilai Select. Apa pun yang tidak cocok dengan role
 * yang ada — sentinel, null, atau uuid role yang sudah dihapus di tab lain —
 * tampil "Tanpa role". Yang penting: uuid tidak pernah bocor ke layar.
 */
export function roleLabel(value: string | null | undefined, roles: RoleOption[]): string {
  if (!value || value === NO_ROLE) return 'Tanpa role';
  return roles.find((r) => r.id === value)?.name ?? 'Tanpa role';
}

/** Peta nilai → label untuk Select berisi pilihan tetap (status, bungkus, dst). */
export function labelFrom(
  map: Record<string, string>,
  value: string | null | undefined,
  fallback: string,
): string {
  if (!value) return fallback;
  return map[value] ?? fallback;
}
