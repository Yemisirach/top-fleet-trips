import type { LocationRow } from "@/types/trip";

const dateText = (value?: string) => (value ? value.slice(0, 10) : "");

const dayLabel = (days: number) => (days === 1 ? "1 day" : `${days} days`);

export default function LocationDaysDetail({ row }: { row: LocationRow }) {
  const days = row.current_location_days ?? row.days ?? 0;
  const basis = row.days_basis || "none";
  const asOf = row.days_as_of || "today";
  const arrival = dateText(row.arrival_date);
  const departure = dateText(row.departure_date);
  const updated = dateText(row.write_date);
  const created = dateText(row.create_date);
  const usedDate = basis === "arrival"
    ? arrival
    : basis === "departure"
      ? departure
      : basis === "write"
        ? updated
        : basis === "create"
          ? created
          : "";

  const headline = basis === "none"
    ? "Days at this location: 0"
    : days === 0
      ? "Days at this location: 0 — it started today"
      : `Days at this location: ${dayLabel(days)}`;

  const explanation = basis === "none"
    ? "This trip has no date, so days stays 0."
    : days === 0
      ? `The report date is ${asOf}. The start date is also ${usedDate}, so no full day has passed.`
      : `The report date ${asOf} minus the start date ${usedDate} is ${dayLabel(days)}.`;

  const choices = [
    { key: "arrival", label: "Arrival", value: arrival, why: "Used first when this date exists." },
    { key: "departure", label: "Departure", value: departure, why: "Used only if arrival is empty." },
    { key: "write", label: "Last update", value: updated, why: "Used only if arrival and departure are empty." },
    { key: "create", label: "Created", value: created, why: "Used only if the other three dates are empty." },
  ];

  return (
    <div className="location-days-detail">
      <strong>{headline}</strong>
      <p>{explanation}</p>
      <p>One date starts the count. Later dates do not replace it.</p>
      <div className="location-days-dates">
        {choices.map((choice) => {
          const used = basis === choice.key;
          return (
            <span key={choice.key} className={used ? "used" : ""}>
              <b>{used ? "Start date" : choice.label}</b>
              {choice.value || "Empty"}
              <small>{used ? "This date is used." : choice.value ? "Not used." : "Empty, so skipped."} {choice.why}</small>
            </span>
          );
        })}
      </div>
    </div>
  );
}
