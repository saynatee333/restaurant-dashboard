/**
 * Merge class names (Tailwind-friendly).
 */
export function cn(...parts) {
  return parts.filter(Boolean).join(' ')
}
