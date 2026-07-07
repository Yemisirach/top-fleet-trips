import type { Trip } from "@/types/trip";

const PLATES = ["67912-82309", "24621-48469", "38145-77210", "55432-11987", "TOP-6573-DJ", "TOP-5002-LJ", "TOP-7126-YF"];

export function generateDemoTrips(count = 10): Trip[] {
  const now = new Date();
  const scenarios = [
    { dest: "Dire Dawa", state: "in_progress", mayet: "online", payment: 24500, orders: 4 },
    { dest: "Bahir Dar", state: "completed", mayet: "offline", payment: 18200, orders: 2 },
    { dest: "Mekelle", state: "planned", mayet: "online", payment: 0, orders: 1 },
    { dest: "Hawassa", state: "in_progress", mayet: "online", payment: 31200, orders: 5 },
    { dest: "Gondar", state: "completed", mayet: "offline", payment: 15800, orders: 3 },
    { dest: "Dire Dawa", state: "completed", mayet: "online", payment: 27500, orders: 4 },
    { dest: "Bahir Dar", state: "in_progress", mayet: "offline", payment: 9800, orders: 2 },
    { dest: "Mekelle", state: "planned", mayet: "online", payment: 0, orders: 0 },
    { dest: "Hawassa", state: "completed", mayet: "online", payment: 42100, orders: 6 },
    { dest: "Gondar", state: "in_progress", mayet: "offline", payment: 19300, orders: 3 },
  ];

  const customers = ["Abdi Trading", "Ethio Logistics", "Dire Dawa Transport", "Bahir Dar Agro", "Mekelle Cement"];
  const drivers = ["Ahmed H", "Meron T", "Yonas K", "Sara M", "Kidus A"];

  return Array.from({ length: count }).map((_, i) => {
    const plate = PLATES[i % PLATES.length];
    const s = scenarios[i % scenarios.length];
    const daysAgo = Math.floor(i / 2);

    return {
      id: 1000 + i,
      name: `TRIP-${1000 + i}`,
      vehicle_plate: plate,
      vehicle_id: plate,
      journey_start: "TOP Factory",
      journey_end: "TOP Factory",
      origin: "TOP Factory",
      destination: s.dest,
      customer_name: customers[i % customers.length],
      driver_name: drivers[i % drivers.length],
      departure_date: new Date(now.getTime() - daysAgo * 86400000).toISOString(),
      arrival_date: s.state === "completed" ? new Date(now.getTime() - (daysAgo - 1) * 86400000).toISOString() : null,
      state: s.state,
      revenue: 38000 + i * 6500,
      expense: 9500 + i * 2800,
      order_count: s.orders,
      payment_request_total: s.payment,
      payment_request_count: s.payment > 0 ? 2 : 0,
      mayet_status: s.mayet,
      mayet_captured_at: new Date(now.getTime() - 3600000).toISOString(),
      trips: [
        { origin: "TOP Factory", destination: s.dest, status: s.state === "completed" ? "done" : "in_progress" }
      ],
    } as unknown as Trip;
  });
}