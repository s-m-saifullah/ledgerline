const months = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * How the web writes a day (WP-11b): "Nov 1", and "Nov 1, 2025" when the year is not this one. Written out here,
 * not imported from the app, so a browser spec checks the rule instead of repeating the code.
 */
export function dayText(iso: string, now = new Date()) {
  const [year, month, day] = iso.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const text = `${months[month - 1]} ${day}`;
  return year === now.getFullYear() ? text : `${text}, ${year}`;
}
