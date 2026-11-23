export function ToggleCard({
  title,
  note,
  checked,
  onChange,
}: {
  title: string;
  note: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="card toggle">
      <div>
        <b>{title}</b>
        <small>{note}</small>
      </div>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <i />
    </label>
  );
}
