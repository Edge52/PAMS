/**
 * Fields beside a list's bulk-actions bar (wave 41). They belong to the ticked-rows form by its id (`form`), so the
 * values go with whichever bulk button is pressed. DataTable's form id is `<table id>-selected`.
 */
const cls = "rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1 text-[13px]";

export function BulkSelect({ form, name, label, placeholder, options }: {
  form: string; name: string; label: string; placeholder: string; options: { value: string | number; label: string }[];
}) {
  return (
    <select name={name} form={form} aria-label={label} defaultValue="" className={`${cls} w-auto max-w-56`}>
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={String(o.value)} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function BulkInput({ form, name, label, placeholder, type = "text", maxLength, width = "w-36" }: {
  form: string; name: string; label: string; placeholder?: string; type?: "text" | "date"; maxLength?: number; width?: string;
}) {
  return <input type={type} name={name} form={form} aria-label={label} placeholder={placeholder} maxLength={maxLength} className={`${cls} ${width}`} />;
}

export function BulkHidden({ form, name, value }: { form: string; name: string; value: string | number }) {
  return <input type="hidden" form={form} name={name} value={value} />;
}
