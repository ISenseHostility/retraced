const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** First date of each month present in the (sorted) date list — clean x-axis ticks. */
export function monthTicks(dates: string[]): string[] {
  const ticks: string[] = [];
  let lastMonth = "";
  for (const date of dates) {
    const month = date.slice(0, 7);
    if (month !== lastMonth) {
      ticks.push(date);
      lastMonth = month;
    }
  }
  // dense ranges (>13 months) thin to every other month
  return ticks.length > 13 ? ticks.filter((_, i) => i % 2 === 0) : ticks;
}

export function tickLabel(date: string, withYear: boolean): string {
  const month = MONTHS[Number(date.slice(5, 7)) - 1] ?? date;
  return withYear ? `${month} ’${date.slice(2, 4)}` : month;
}
