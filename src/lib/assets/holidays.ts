/**
 * Egyptian public holidays for 2026–2027 (wave 38), a starting list the hospital edits. Pure.
 *
 * Fixed holidays are by law; the government often moves a mid-week one to a Thursday or Sunday by decree, so the
 * dates below are the ones announced or expected (marked "in lieu" where moved). Islamic holidays follow the moon
 * sighting and are marked approximate until the official announcement. Coptic Easter Sunday is a holiday for
 * Christian staff only and is left out; add it if your contracts count it. Source: officeholidays.com (Egypt 2026 and
 * 2027 pages), checked Nov 2026.
 */
export type HolidaySeed = { day: string; name: string; approximate?: boolean };

export const EGYPT_HOLIDAYS_2026_2027: HolidaySeed[] = [
  { day: "2026-01-07", name: "Coptic Christmas" },
  { day: "2026-01-29", name: "Revolution Day, 25 January (in lieu)" },
  ...["2026-03-19", "2026-03-20", "2026-03-21", "2026-03-22", "2026-03-23"].map((day) => ({ day, name: "Eid al-Fitr", approximate: true })),
  { day: "2026-04-13", name: "Sham El Nessim" },
  { day: "2026-04-25", name: "Sinai Liberation Day" },
  { day: "2026-05-07", name: "Labour Day (in lieu)" },
  { day: "2026-05-26", name: "Arafat Day", approximate: true },
  ...["2026-05-27", "2026-05-28", "2026-05-29", "2026-05-30", "2026-05-31"].map((day) => ({ day, name: "Eid al-Adha", approximate: true })),
  { day: "2026-06-18", name: "Islamic New Year", approximate: true },
  { day: "2026-07-02", name: "Revolution Day, 30 June (in lieu)" },
  { day: "2026-07-23", name: "Revolution Day, 23 July" },
  { day: "2026-08-27", name: "Prophet's Birthday", approximate: true },
  { day: "2026-10-08", name: "Armed Forces Day (in lieu)" },
  { day: "2027-01-07", name: "Coptic Christmas" },
  { day: "2027-01-25", name: "Revolution Day, 25 January" },
  ...["2027-03-09", "2027-03-10", "2027-03-11"].map((day) => ({ day, name: "Eid al-Fitr", approximate: true })),
  { day: "2027-04-25", name: "Sinai Liberation Day" },
  { day: "2027-05-01", name: "Labour Day" },
  { day: "2027-05-03", name: "Sham El Nessim" },
  { day: "2027-05-15", name: "Arafat Day", approximate: true },
  ...["2027-05-16", "2027-05-17", "2027-05-18"].map((day) => ({ day, name: "Eid al-Adha", approximate: true })),
  { day: "2027-06-06", name: "Islamic New Year", approximate: true },
  { day: "2027-06-30", name: "Revolution Day, 30 June" },
  { day: "2027-07-23", name: "Revolution Day, 23 July" },
  { day: "2027-08-14", name: "Prophet's Birthday", approximate: true },
  { day: "2027-10-07", name: "Armed Forces Day (6 Oct, expected in lieu)" },
];
