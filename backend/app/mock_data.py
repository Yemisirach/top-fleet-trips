"""In-memory mock database with seeded demo data for all fleet scenarios."""

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Optional
import random
import json

# ------------------------------------------------------------------------------
# Data classes
# ------------------------------------------------------------------------------

@dataclass
class MockDriver:
    id: int
    name: str
    phone: str
    license_no: str
    active: bool = True

@dataclass
class MockLocation:
    id: int
    name: str
    location_type: str = "city"
    active: bool = True

@dataclass
class MockVehicle:
    id: int
    license_plate: str
    model: str
    brand: str
    fuel_type: str
    driver_id: Optional[int]
    state_id: Optional[int]
    active: bool = True

@dataclass
class MockFinancialTemplate:
    id: int
    name: str
    total_expense: float
    total_revenue: float

@dataclass
class MockTimelineEntry:
    timestamp: datetime
    location: str
    source: str  # 'GPS' | 'Odoo' | 'Supervisor'
    discrepancy_flag: bool = False
    note: str = ''

@dataclass
class MockTrip:
    id: int
    name: str
    driver_id: int
    departure_id: int
    destination_id: int
    vehicle_id: int
    financial_template_id: int
    state: str  # draft, available, assigned, dispatched, done
    departure_date: date
    arrival_date: Optional[date]
    current_location_id: Optional[int]
    current_location_note: str
    note: str
    general_note: str
    expense_note: str
    revenue_note: str
    create_date: datetime
    write_date: datetime
    total_expense: float
    total_revenue: float
    timeline: list[MockTimelineEntry] = field(default_factory=list)


# ------------------------------------------------------------------------------
# Seeding helpers
# ------------------------------------------------------------------------------

ETHIOPIAN_NAMES = [
    "Abebe Bekele",
    "Kebede Tadesse",
    "Dawit Mengistu",
    "Solomon Girma",
    "Bereket Haile",
    "Tesfaye Alemu",
    "Mulugeta Seyoum",
    "Yonas Demeke",
    "Fikadu Tesfaye",
    "Henok Abebe",
    "Mekonen Tadesse",
    "Girma Belay",
    "Chilot Adane",
    "Kassa Tsegaye",
    "Wondimu Jember",
    "Zerihun Mesfin",
    "Amanuel Tewolde",
    "Biniam Abera",
    "Dagmawi Asefa",
    "Eyob Tilahun",
    "Feysel Megersa",
    "Gedion Asfaw",
    "Habtamu Desalegn",
    "Israel Bekele",
    "Jemal Tadesse",
    "Kaleab Seyoum",
    "Lema Abebe",
    "Menelik Teshome",
    "Nebiyu Girma",
    "Ousmane Keita",
]

CITIES = [
    "Addis Ababa",
    "Dire Dawa",
    "Bahir Dar",
    "Mekelle",
    "Hawassa",
    "Adama",
    "Jimma",
    "Arba Minch",
    "Jijiga",
    "Nekemte",
    "Djibouti City",
    "Nairobi",
    "Mombasa",
    "Khartoum",
    "Kampala",
]

BRANDS = ["Isuzu", "Shacman", "Toyota", "SINO", "Peugeot", "Ford", "Mercedes", "Volvo"]
MODELS = {
    "Isuzu": ["ELF", "FTR", "NQR", "NPR"],
    "Shacman": ["F2000", "F3000", "M3000", "X3000"],
    "Toyota": ["Hilux", "Land Cruiser", "Hiace", "Coaster A"],
    "SINO": ["HOWO", "STR", "HOKA"],
    "Peugeot": ["Boxer", "Expert"],
    "Ford": ["Transit", "Ranger"],
    "Mercedes": ["Actros", "Atego", "Sprinter"],
    "Volvo": ["FH", "FM", "FE"],
}

FUEL_TYPES = ["diesel", "gasoline", "electric"]
TRIP_STATES = ["draft", "available", "assigned", "dispatched", "done"]


class MockDatabase:
    """In-memory mock database for demo data."""

    def __init__(self):
        self.drivers: list[MockDriver] = []
        self.locations: list[MockLocation] = []
        self.vehicles: list[MockVehicle] = []
        self.financial_templates: list[MockFinancialTemplate] = []
        self.trips: list[MockTrip] = []
        self._seed()

    def _seed(self):
        random.seed(42)
        self._seed_locations()
        self._seed_drivers()
        self._seed_vehicles()
        self._seed_financial_templates()
        self._seed_trips()

    def _seed_locations(self):
        self.locations = [
            MockLocation(id=i + 100, name=name)
            for i, name in enumerate(CITIES)
        ]

    def _seed_drivers(self):
        self.drivers = [
            MockDriver(
                id=i + 1,
                name=name,
                phone=f"09{random.randint(10, 99)}-{random.randint(1000000, 9999999)}",
                license_no=f"ETH-{random.randint(100000, 999999)}",
            )
            for i, name in enumerate(ETHIOPIAN_NAMES)
        ]

    def _seed_vehicles(self):
        self.vehicles = []
        for i in range(50):
            brand = random.choice(BRANDS)
            model = random.choice(MODELS[brand])
            self.vehicles.append(
                MockVehicle(
                    id=10000 + i,
                    license_plate=f"{random.randint(10000, 99999)}-{random.randint(10000, 99999)}",
                    model=model,
                    brand=brand,
                    fuel_type=random.choice(FUEL_TYPES),
                    driver_id=random.choice(self.drivers).id if random.random() > 0.3 else None,
                    state_id=None,
                    active=True,
                )
            )

    def _seed_financial_templates(self):
        self.financial_templates = [
            MockFinancialTemplate(id=1, name="Local Delivery", total_expense=15000, total_revenue=25000),
            MockFinancialTemplate(id=2, name="Long Haul - Domestic", total_expense=35000, total_revenue=55000),
            MockFinancialTemplate(id=3, name="International - Djibouti", total_expense=75000, total_revenue=120000),
            MockFinancialTemplate(id=4, name="Cross-Border - Kenya", total_expense=95000, total_revenue=150000),
            MockFinancialTemplate(id=5, name="Bulk Cargo", total_expense=45000, total_revenue=70000),
        ]

    def _seed_trips(self):
        self.trips = []
        now = datetime(2026, 6, 24)
        for i in range(120):
            state = random.choices(TRIP_STATES, weights=[15, 20, 25, 25, 15])[0]
            dep_loc = random.choice(self.locations)
            dest_loc = random.choice([l for l in self.locations if l.id != dep_loc.id])
            vehicle = random.choice(self.vehicles)
            driver = random.choice(self.drivers)
            financial = random.choice(self.financial_templates)
            dep_date = now + timedelta(days=random.randint(-30, 30))

            if state in ("dispatched", "done"):
                arr_date = dep_date + timedelta(days=random.randint(1, 5))
            else:
                arr_date = None

            trip = MockTrip(
                id=100000 + i,
                name=f" route-{dep_loc.name[:3].upper()}-{dest_loc.name[:3].upper()}-{i + 1}",
                driver_id=driver.id,
                departure_id=dep_loc.id,
                destination_id=dest_loc.id,
                vehicle_id=vehicle.id,
                financial_template_id=financial.id,
                state=state,
                departure_date=dep_date.date(),
                arrival_date=arr_date.date() if arr_date else None,
                current_location_id=random.choice([dep_loc.id, dest_loc.id, None]),
                current_location_note="",
                note=f"Trip from {dep_loc.name} to {dest_loc.name}",
                general_note="",
                expense_note=f"Fuel: {random.randint(5000, 20000)} birr",
                revenue_note=f"Delivery charge: {random.randint(20000, 100000)} birr",
                create_date=now - timedelta(days=random.randint(0, 60)),
                write_date=now,
                total_expense=random.randint(15000, 120000),
                total_revenue=random.randint(25000, 180000),
            )

            # Generate timeline for this trip
            trip.timeline = self._generate_mock_timeline(trip, dep_loc.name, dest_loc.name)

            self.trips.append(trip)

    def _generate_mock_timeline(self, trip: MockTrip, from_city: str, to_city: str) -> list[MockTimelineEntry]:
        """Generate realistic timeline entries for a trip."""
        timeline: list[MockTimelineEntry] = []
        now = datetime(2026, 6, 24)

        # Odoo: departure
        timeline.append(
            MockTimelineEntry(
                timestamp=datetime.combine(trip.departure_date, datetime.min.time()).replace(hour=8 + random.randint(0, 2)),
                location=from_city,
                source="Odoo",
                discrepancy_flag=False,
                note="Trip departed from origin",
            )
        )

        # For dispatched/done trips, generate intermediate waypoints
        if trip.state in ("dispatched", "done"):
            # GPS waypoints (2-4 legs)
            num_gps_legs = random.randint(2, 4)
            for j in range(num_gps_legs):
                # Random time offset during the trip
                hour_offset = random.randint(2, 18)
                trip_days = 0
                if trip.arrival_date:
                    trip_days = max(0, (trip.arrival_date - trip.departure_date).days)
                day_offset = random.randint(0, trip_days)
                
                
                gps_time = datetime.combine(trip.departure_date, datetime.min.time()).replace(hour=8) + timedelta(days=day_offset, hours=hour_offset)
                
                # Determine location based on progress
                if j < num_gps_legs - 1:
                    location = random.choice([from_city, to_city, "Checkpoint"])
                else:
                    location = to_city

                # 30% chance of GPS discrepancy
                discrepancy = random.random() < 0.3
                note = "GPS tracking active" if not discrepancy else "GPS vs Odoo discrepancy detected"

                timeline.append(
                    MockTimelineEntry(
                        timestamp=gps_time,
                        location=location,
                        source="GPS",
                        discrepancy_flag=discrepancy,
                        note=note,
                    )
                )

            # Odoo: arrival (for done trips)
            if trip.state == "done" and trip.arrival_date:
                timeline.append(
                    MockTimelineEntry(
                        timestamp=datetime.combine(trip.arrival_date, datetime.min.time()).replace(hour=16 + random.randint(0, 4)),
                        location=to_city,
                        source="Odoo",
                        discrepancy_flag=False,
                        note="Trip arrived at destination",
                    )
                )

        # ECSupervisor check-in (random)
        if random.random() < 0.4:
            timeline.append(
                MockTimelineEntry(
                    timestamp=datetime.combine(trip.departure_date, datetime.min.time()).replace(hour=14),
                    location=to_city if random.random() > 0.5 else from_city,
                    source="Supervisor",
                    discrepancy_flag=False,
                    note="Supervisor check-in",
                )
            )

        # Sort by timestamp
        timeline.sort(key=lambda x: x.timestamp)
        return timeline

    # -----------------------------------------------------------------------
    # Query methods
    # -----------------------------------------------------------------------

    def get_summary(self) -> dict:
        return {
            "total_vehicles": len(self.vehicles),
            "total_trips": len(self.trips),
            "total_drivers": len(self.drivers),
            "total_locations": len(self.locations),
        }

    def get_vehicles_by_brand(self) -> list[dict]:
        counts = {}
        for v in self.vehicles:
            counts[v.brand] = counts.get(v.brand, 0) + 1
        return sorted([{"brand": k, "count": v} for k, v in counts.items()], key=lambda x: x["count"], reverse=True)

    def get_trips_by_state(self) -> list[dict]:
        counts = {}
        for t in self.trips:
            counts[t.state] = counts.get(t.state, 0) + 1
        return sorted([{"state": k, "count": v} for k, v in counts.items()], key=lambda x: x["count"], reverse=True)

    def get_recent_trips(self, limit: int = 10) -> list[dict]:
        sorted_trips = sorted(self.trips, key=lambda t: t.create_date, reverse=True)
        return [
            {
                "id": t.id,
                "name": t.name,
                "state": t.state,
                "departure_date": str(t.departure_date),
                "driver_name": next((d.name for d in self.drivers if d.id == t.driver_id), None),
                "from_city": next((l.name for l in self.locations if l.id == t.departure_id), None),
                "to_city": next((l.name for l in self.locations if l.id == t.destination_id), None),
                "vehicle_plate": next((v.license_plate for v in self.vehicles if v.id == t.vehicle_id), None),
                "total_revenue": t.total_revenue,
            }
            for t in sorted_trips[:limit]
        ]

    def get_all_vehicles(self) -> list[dict]:
        return [
            {
                "id": v.id,
                "license_plate": v.license_plate,
                "model": v.model,
                "brand": v.brand,
                "fuel_type": v.fuel_type,
                "driver_name": next((d.name for d in self.drivers if d.id == v.driver_id), None) if v.driver_id else None,
                "active": v.active,
            }
            for v in self.vehicles
        ]

    def get_trip_detail(self, trip_id: int) -> Optional[dict]:
        t = next((trip for trip in self.trips if trip.id == trip_id), None)
        if not t:
            return None
        return {
            "id": t.id,
            "name": t.name,
            "state": t.state,
            "driver": next((d.name for d in self.drivers if d.id == t.driver_id), None),
            "from_city": next((l.name for l in self.locations if l.id == t.departure_id), None),
            "to_city": next((l.name for l in self.locations if l.id == t.destination_id), None),
            "vehicle": next((v.license_plate for v in self.vehicles if v.id == t.vehicle_id), None),
            "departure_date": str(t.departure_date),
            "arrival_date": str(t.arrival_date) if t.arrival_date else None,
            "expense_note": t.expense_note,
            "revenue_note": t.revenue_note,
            "total_expense": t.total_expense,
            "total_revenue": t.total_revenue,
        }

    def get_trip_timeline(self, trip_id: int) -> Optional[list[dict]]:
        """Return timeline entries for a specific trip."""
        t = next((trip for trip in self.trips if trip.id == trip_id), None)
        if not t:
            return None
        return [
            {
                "timestamp": entry.timestamp.isoformat(),
                "location": entry.location,
                "source": entry.source,
                "discrepancy_flag": entry.discrepancy_flag,
                "note": entry.note,
            }
            for entry in t.timeline
        ]

    def get_trip_state_counts(self) -> dict:
        return dict(self._get_trips_by_state_counts())

    def _get_trips_by_state_counts(self):
        counts = {}
        for t in self.trips:
            counts[t.state] = counts.get(t.state, 0) + 1
        return counts

    def get_full_dashboard(self) -> dict:
        """Return everything the dashboard needs in one call."""
        return {
            "summary": self.get_summary(),
            "vehicles_by_brand": self.get_vehicles_by_brand(),
            "trips_by_state": self.get_trips_by_state(),
            "recent_trips": self.get_recent_trips(20),
            "active_trip_count": sum(1 for t in self.trips if t.state in ("assigned", "dispatched")),
            "total_revenue": sum(t.total_revenue for t in self.trips),
            "total_expense": sum(t.total_expense for t in self.trips),
        }


# Global instance
mock_db = MockDatabase()
