import type { LocationRow } from "@/types/trip";

const BASIS_LABEL: Record<string, string> = {
  arrival: "arrival date",
  departure: "departure date",
  write: "last update",
  create: "created date",
  none: "no date",
};

const dateText = (value?: string) => (value ? value.slice(0, 10) : "—");

export default function LocationDaysDetail({ row }: { row: LocationRow }) {
  const days = row.current_location_days ?? row.days ?? 0;
  const basis = row.days_basis || "none";
  const usedDate = basis === "arrival"
    ? row.arrival_date
    : basis === "departure"
      ? row.departure_date
      : basis === "write"
        ? row.write_date
        : basis === "create"
          ? row.create_date
          : undefined;
  const asOf = row.days_as_of || "today";
  return (
    <div className="location-days-detail">
      <strong>Days = {asOf} − {BASIS_LABEL[basis] || "date used"}</strong>
      <p>
        {basis === "none"
          ? "This vehicle has no trip date, so days is 0."
          : `${days} = ${asOf} minus ${dateText(usedDate)}. The first filled date is used: arrival, then departure, then last update, then created.`}
      </p>
      <div className="location-days-dates">
        <span className={basis === "arrival" ? "used" : ""}>Arrival {dateText(row.arrival_date)}</span>
        <span className={basis === "departure" ? "used" : ""}>Departure {dateText(row.departure_date)}</span>
        <span className={basis === "write" ? "used" : ""}>Last update {dateText(row.write_date)}</span>
        <span className={basis === "create" ? "used" : ""}>Created {dateText(row.create_date)}</span>
      </div>
    </div>
  );
}
