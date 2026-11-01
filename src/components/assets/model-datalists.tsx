/** Pick lists for the manufacturer and model inputs (`list="dl-makers"` / `list="dl-models"`); typing anything else still works. */
export function ModelDatalists({ makers, models }: { makers: string[]; models: string[] }) {
  return (
    <>
      <datalist id="dl-makers">{makers.map((m) => <option key={m} value={m} />)}</datalist>
      <datalist id="dl-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
    </>
  );
}
