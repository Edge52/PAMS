/**
 * An Arabic legal name on a formal document (wave 38): right to left, in the Arabic font (--font-plex-arabic via
 * the font-arabic class). Only letters, minutes and the purchase order print use it; the interface stays English.
 */
export function LegalNameAr({ name, block = true, className = "" }: { name: string | null | undefined; block?: boolean; className?: string }) {
  if (!name) return null;
  const Tag = block ? "span" : "bdi";
  return <Tag lang="ar" dir="rtl" className={`font-arabic ${block ? "block" : ""} ${className}`.trim()}>{name}</Tag>;
}
