"""In-memory mock database with seeded demo data for Topwater Ethiopia journey tracking."""

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Optional
import random

# -----------------------------------------------------------------------------
# Data classes
# -----------------------------------------------------------------------------

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
    mayet_status: Optional[str] = None
    mayet_latitude: Optional[float] = None
    mayet_longitude: Optional[float] = None
    mayet_captured_at: Optional[str] = None


@dataclass
class MockTimelineEntry:
    timestamp: datetime
    location: str
    source: str  # 'GPS' | 'Odoo' | 'Supervisor'
    discrepancy_flag: bool
    note: str


@dataclass
class MockTrip:
    """A single leg within a journey (e.g. Topwater -> Dire Dawa)."""
    id: int
    origin: str
    destination: str
    distance_km: int
    departure_date: date
    arrival_date: Optional[date]
    status: str  # planned, in_progress, completed, cancelled
    revenue: float
    expense: float
    timeline: list[MockTimelineEntry] = field(default_factory=list)


@dataclass
class MockJourney:
    """A full journey: Topwater -> destination(s) -> Topwater. Contains multiple trips."""
    id: int
    vehicle_id: int
    driver_id: int
    departure_date: date
    return_date: Optional[date]
    status: str  # planned, in_progress, completed, cancelled
    total_revenue: float
    total_expense: float
    cargo_type: str
    cargo_weight_kg: float
    trips: list[MockTrip] = field(default_factory=list)
    fuel_cost: float = 0.0
    driver_allowance: float = 0.0
    tolls: float = 0.0
    maintenance: float = 0.0
    other_expense: float = 0.0
    paid_amount: float = 0.0
    pending_payment: float = 0.0
    paid_expense_amount: float = 0.0
    pending_expense_payment: float = 0.0

    @property
    def origin(self) -> str:
        return BASE_LOCATION

    @property
    def destinations(self) -> list[str]:
        return [trip.destination for trip in self.trips if trip.destination != BASE_LOCATION]

    @property
    def total_distance(self) -> int:
        return sum(trip.distance_km for trip in self.trips)


# -----------------------------------------------------------------------------
# Seeding helpers
# -----------------------------------------------------------------------------

ETHIOPIAN_NAMES = [
    "Abebe Bekele", "Kebede Tadesse", "Dawit Mengistu", "Solomon Girma",
    "Bereket Haile", "Tesfaye Alemu", "Mulugeta Seyoum", "Yonas Demeke",
    "Fikadu Tesfaye", "Henok Abebe", "Mekonen Tadesse", "Girma Belay",
    "Chilot Adane", "Kassa Tsegaye", "Wondimu Jember", "Zerihun Mesfin",
    "Amanuel Tewolde", "Biniam Abera", "Dagmawi Asefa", "Eyob Tilahun",
    "Feysel Megersa", "Gedion Asfaw", "Habtamu Desalegn", "Israel Bekele",
    "Jemal Tadesse", "Kaleab Seyoum", "Lema Abebe", "Menelik Teshome",
    "Nebiyu Girma", "Ousmane Keita", "Tewodros Girma", "Yared Haile",
    "Addisu Worku", "Berhanu Alemu", "Desta Bekele", "Eskinder Tadesse",
]

DESTINATIONS = [
    "Dire Dawa", "Bahir Dar", "Mekelle", "Hawassa", "Adama",
    "Jimma", "Arba Minch", "Jijiga", "Nekemte", "Djibouti City",
    "Nairobi", "Mombasa", "Khartoum", "Kampala", "Moyale",
    "Gondar", "Axum", "Lalibela", "Harar", "Sodo",
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
CARGO_TYPES = ["Mineral Water", "Construction Materials", "Food Products", "Textiles", "Machinery", "Fuel", "Consumer Goods"]
STATUS_CHOICES = ["planned", "in_progress", "completed", "cancelled"]

BASE_LOCATION = "Topwater Ethiopia HQ, Addis Ababa"


class MockDatabase:
    """In-memory mock database for Topwater Ethiopia journey demo data."""

    def __init__(self):
        self.drivers: list[MockDriver] = []
        self.locations: list[MockLocation] = []
        self.vehicles: list[MockVehicle] = []
        self.journeys: list[MockJourney] = []
        self._seed()

    def _seed(self):
        random.seed(42)
        self._seed_locations()
        self._seed_drivers()
        self._seed_vehicles()
        self._seed_journeys()

    def _seed_locations(self):
        self.locations = [
            MockLocation(id=i + 100, name=name)
            for i, name in enumerate(DESTINATIONS)
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
            
            if i == 0:
                plate = "16652-34002"
            elif i == 1:
                plate = "16651-34001"
            else:
                plate = f"{random.randint(10000, 99999)}-{random.randint(10000, 99999)}"

            self.vehicles.append(
                MockVehicle(
                    id=10000 + i,
                    license_plate=plate,
                    model=model,
                    brand=brand,
                    fuel_type=random.choice(FUEL_TYPES),
                    driver_id=random.choice(self.drivers).id if random.random() > 0.2 else None,
                    state_id=None,
                    active=True,
                    mayet_status=random.choice([
                        "Driving near Awash, Afar (Speed: 45km/h)",
                        "Parked at Mille Checkpoint",
                        "Moving through Semera, Afar (Speed: 60km/h)",
                        "Parked at Galafi Border Crossing",
                        "Idling at Djibouti Port Terminal",
                        "Driving near Adama, Oromia (Speed: 70km/h)",
                        "Resting in Mojo, Oromia",
                        "Driving near Dire Dawa (Speed: 55km/h)"
                    ]) if random.random() > 0.1 else None
                )
            )

    def _seed_journeys(self):
        """Generate realistic journeys with multiple trips from Topwater base."""
        self.journeys = []
        now = datetime(2026, 6, 24)

        for i in range(120):
            vehicle = random.choice(self.vehicles)
            driver = random.choice(self.drivers)
            cargo = random.choice(CARGO_TYPES)
            cargo_weight = random.randint(500, 20000)
            
            # Journey starts from Topwater
            dep_date = now + timedelta(days=random.randint(-90, 30))
            # Journeys have 2-3 trips (outbound + return, or more)
            num_trips = random.choices([2, 3], weights=[70, 30])[0]

            trips: list[MockTrip] = []
            current_date = dep_date.date()
            remaining_destinations = DESTINATIONS.copy()
            random.shuffle(remaining_destinations)
            used_destinations = []

            for t_idx in range(num_trips):
                if t_idx == num_trips - 1:
                    # Last leg always returns to base
                    dest = BASE_LOCATION
                else:
                    # Pick a destination from the list
                    dest = remaining_destinations.pop()
                
                # Distance and time for this leg
                distance = random.randint(100, 1500)
                trip_duration = random.randint(1, max(1, distance // 300))
                current_date_obj = current_date
                arr_date = current_date + timedelta(days=trip_duration)
                
                # Revenue/Expense for this leg
                base_rate = random.uniform(15, 35)
                revenue = distance * base_rate + (cargo_weight / 1000) * random.uniform(50, 150)
                fuel_cost = distance * random.uniform(1.5, 3.0)
                driver_allowance = trip_duration * random.uniform(500, 1500)
                tolls = random.uniform(0, 5000) if distance > 500 else 0
                maintenance = random.uniform(500, 3000)
                other = random.uniform(200, 2000)
                total_expense_leg = fuel_cost + driver_allowance + tolls + maintenance + other
                
                status_weights = [15, 35, 40, 5]
                status = random.choices(STATUS_CHOICES, weights=status_weights)[0]

                trip = MockTrip(
                    id=300000 + i * 10 + t_idx,
                    origin="",  # Set below
                    destination=dest,
                    distance_km=distance,
                    departure_date=current_date,
                    arrival_date=arr_date if status in ["completed", "in_progress"] else None,
                    status=status,
                    revenue=round(revenue, 2),
                    expense=round(total_expense_leg, 2),
                )
                # Fix origin: use the previous destination, or BASE_LOCATION for the first leg
                if t_idx == 0:
                    trip.origin = BASE_LOCATION
                else:
                    trip.origin = trips[-1].destination
                
                trips.append(trip)
                current_date = arr_date + timedelta(days=random.randint(0, 2))
            
            # Calculate journey totals
            total_revenue = sum(trip.revenue for trip in trips)
            total_expense = sum(trip.expense for trip in trips)
            total_fuel = sum(t.distance_km * random.uniform(1.5, 3.0) for t in trips)  # Approximate
            total_allowance = sum(random.uniform(500, 1500) for _ in trips)
            paid_ratio = random.uniform(0.35, 1.0)
            expense_paid_ratio = random.uniform(0.25, 0.95)
            
            # status is based on the last trip
            final_status = trips[-1].status if trips else "planned"

            j = MockJourney(
                id=200000 + i,
                vehicle_id=vehicle.id,
                driver_id=driver.id,
                departure_date=dep_date.date(),
                return_date=current_date,
                status=final_status,
                total_revenue=round(total_revenue, 2),
                total_expense=round(total_expense, 2),
                cargo_type=cargo,
                cargo_weight_kg=cargo_weight,
                trips=trips,
                fuel_cost=round(total_fuel, 2),
                driver_allowance=round(total_allowance, 2),
                tolls=round(sum(t.expense * 0.12 for t in trips), 2),
                maintenance=round(sum(t.expense * 0.08 for t in trips), 2),
                other_expense=round(sum(t.expense * 0.1 for t in trips), 2),
                paid_amount=round(total_revenue * paid_ratio, 2),
                pending_payment=round(total_revenue * (1 - paid_ratio), 2),
                paid_expense_amount=round(total_expense * expense_paid_ratio, 2),
                pending_expense_payment=round(total_expense * (1 - expense_paid_ratio), 2),
            )
            self.journeys.append(j)

        # Sort by departure date descending
        self.journeys.sort(key=lambda j: j.departure_date, reverse=True)

#     def _generate_trip_timeline(self, trip: MockTrip) -> list[MockTimelineEntry]:
#         """Generate timeline for a single trip leg."""
#         timeline: list[MockTimelineEntry] = []
#         timeline.append(
#             MockTimelineEntry(
#                 timestamp=datetime.combine(trip.departure_date, datetime.min.time()).replace(hour=6 + random.randint(0, 2)),
#                 location=trip.origin,
#                 source="Odoo",
#                 discrepancy_flag=False,
#                 note=f"Departed from {trip.origin}",
#             )
#         )
#         # ... (add more timeline entries as needed)
#         return timeline

    # -------------------------------------------------------------------------
    # Query methods
    # -------------------------------------------------------------------------

    def get_summary(self) -> dict:
        return {
            "total_vehicles": len(self.vehicles),
            "total_journeys": len(self.journeys),
            "total_drivers": len(self.drivers),
            "total_locations": len(self.locations),
        }

    def get_vehicles_by_brand(self) -> list[dict]:
        counts = {}
        for v in self.vehicles:
            counts[v.brand] = counts.get(v.brand, 0) + 1
        return sorted([{"brand": k, "count": v} for k, v in counts.items()], key=lambda x: x["count"], reverse=True)

    def get_journeys_by_status(self) -> list[dict]:
        counts = {}
        for j in self.journeys:
            counts[j.status] = counts.get(j.status, 0) + 1
        return sorted([{"status": k, "count": v} for k, v in counts.items()], key=lambda x: x["count"], reverse=True)

    def _journey_to_dict(self, j: MockJourney) -> dict:
        vehicle = next((v for v in self.vehicles if v.id == j.vehicle_id), None)
        driver = next((d for d in self.drivers if d.id == j.driver_id), None)
        profit = j.total_revenue - j.total_expense

        trips_data = []
        for trip in j.trips:
            trips_data.append({
                "id": trip.id,
                "origin": trip.origin,
                "destination": trip.destination,
                "distance_km": trip.distance_km,
                "departure_date": str(trip.departure_date),
                "arrival_date": str(trip.arrival_date) if trip.arrival_date else None,
                "status": trip.status,
                "revenue": trip.revenue,
                "expense": trip.expense,
            })

        return {
            "id": j.id,
            "vehicle_plate": vehicle.license_plate if vehicle else "Unknown",
            "vehicle_brand": vehicle.brand if vehicle else "Unknown",
            "mayet_status": vehicle.mayet_status if vehicle else None,
            "mayet_latitude": vehicle.mayet_latitude if vehicle else None,
            "mayet_longitude": vehicle.mayet_longitude if vehicle else None,
            "mayet_captured_at": vehicle.mayet_captured_at if vehicle else None,
            "driver_name": driver.name if driver else "Unknown",
            "driver_phone": driver.phone if driver else "",
            "origin": j.origin,
            "destinations": j.destinations,
            "departure_date": str(j.departure_date),
            "return_date": str(j.return_date) if j.return_date else None,
            "status": j.status,
            "total_revenue": j.total_revenue,
            "total_expense": j.total_expense,
            "profit": round(profit, 2),
            "paid_amount": j.paid_amount,
            "pending_payment": j.pending_payment,
            "payment_request_total": j.total_expense,
            "paid_expense_amount": j.paid_expense_amount,
            "pending_expense_payment": j.pending_expense_payment,
            "customer_name": "Demo Customer",
            "order_receivable_count": len(j.trips),
            "payment_request_count": len(j.trips),
            "order_count": len(j.trips),
            "fuel_cost": j.fuel_cost,
            "driver_allowance": j.driver_allowance,
            "tolls": j.tolls,
            "maintenance": j.maintenance,
            "other_expense": j.other_expense,
            "cargo_type": j.cargo_type,
            "cargo_weight_kg": j.cargo_weight_kg,
            "trips": trips_data,
        }

    def get_recent_journeys(self, limit: int = 10) -> list[dict]:
        sorted_journeys = sorted(self.journeys, key=lambda j: j.departure_date, reverse=True)
        return [self._journey_to_dict(j) for j in sorted_journeys[:limit]]

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

    def get_journey_detail(self, journey_id: int) -> Optional[dict]:
        journey = next((j for j in self.journeys if j.id == journey_id), None)
        if not journey:
            return None
        return self._journey_to_dict(journey)

    def seed_mayet_vehicle_statuses(self, positions: list[dict]) -> int:
        """Use cached Mayet vehicles to make demo trips look like live fleet trips."""
        updated = 0
        usable = [p for p in positions if p.get("plate")]
        for vehicle, position in zip(self.vehicles, usable):
            vehicle.license_plate = str(position.get("plate"))
            vehicle.mayet_status = position.get("location")
            vehicle.mayet_latitude = position.get("latitude")
            vehicle.mayet_longitude = position.get("longitude")
            vehicle.mayet_captured_at = position.get("captured_at")
            updated += 1
        return updated

    def get_full_dashboard(self) -> dict:
        """Return everything the dashboard needs in one call."""
        total_revenue = sum(j.total_revenue for j in self.journeys)
        total_expense = sum(j.total_expense for j in self.journeys)
        customer_paid = sum(j.paid_amount for j in self.journeys)
        customer_pending = sum(j.pending_payment for j in self.journeys)
        vendor_paid = sum(j.paid_expense_amount for j in self.journeys)
        vendor_pending = sum(j.pending_expense_payment for j in self.journeys)
        active_count = sum(1 for j in self.journeys if j.status in ("planned", "in_progress"))
        profit = total_revenue - total_expense
        collection_rate = (customer_paid / total_revenue * 100) if total_revenue else 0
        vendor_clearance_rate = (vendor_paid / total_expense * 100) if total_expense else 0
        active_trip_ratio = (active_count / len(self.journeys) * 100) if self.journeys else 0
        profit_margin = (profit / total_revenue * 100) if total_revenue else 0
        mock_payment_requests = []
        for i, j in enumerate(self.journeys):
            if j.total_expense > 0:
                v = next((v for v in self.vehicles if v.id == j.vehicle_id), None)
                plate = v.license_plate if v else "Unknown"
                driver = next((d.name for d in self.drivers if d.id == v.driver_id), "Unknown") if v and v.driver_id else "Unknown"
                dest = j.destinations[0] if j.destinations else "Unknown Destination"
                route_str = f"From {j.origin.split(',')[0]} to {dest}"
                mock_payment_requests.append({
                    "id": 1000 + i,
                    "name": f"PR-{1000+i}",
                    "trip_id": j.id,
                    "trip_reference": route_str,
                    "vehicle_plate": plate,
                    "date": j.departure_date.isoformat(),
                    "state": "approved" if i % 3 != 0 else "draft",
                    "requester_name": driver,
                    "supervisor_name": "Teklu Teshome" if i % 2 == 0 else "Dawit Mengistu",
                    "total_amount": round(j.total_expense * 0.4, 2),
                    "line_items": [
                        {"item": "Fuel", "amount": round(j.total_expense * 0.25, 2), "description": f"{random.randint(10, 100)}L * {round(random.uniform(50, 180), 2)} = {round(j.total_expense * 0.25, 2)}"},
                        {"item": "Per diem", "amount": round(j.total_expense * 0.15, 2), "description": "Driver allowance"},
                    ]
                })

        return {
            "summary": self.get_summary(),
            "vehicles_by_brand": self.get_vehicles_by_brand(),
            "journeys_by_status": self.get_journeys_by_status(),
            "recent_journeys": self.get_recent_journeys(20),
            "active_journey_count": active_count,
            "total_revenue": round(total_revenue, 2),
            "total_expense": round(total_expense, 2),
            "total_profit": round(profit, 2),
            "payment_summary": {
                "receivable_total": round(total_revenue, 2),
                "customer_paid_total": round(customer_paid, 2),
                "customer_pending_total": round(customer_pending, 2),
                "receivable_trip_count": len(self.journeys),
                "expense_total": round(total_expense, 2),
                "payment_request_total": round(total_expense, 2),
                "vendor_paid_total": round(vendor_paid, 2),
                "vendor_pending_total": round(vendor_pending, 2),
                "payment_request_trip_count": len(self.journeys),
            },
            "payment_requests": mock_payment_requests,
            "custom_kpis": [
                {"label": "Customer Payment Collected", "value": round(customer_paid, 2), "format": "money", "tone": "green"},
                {"label": "Pending Customer Payment", "value": round(customer_pending, 2), "format": "money", "tone": "red"},
                {"label": "Vendor Payments Cleared", "value": round(vendor_paid, 2), "format": "money", "tone": "green"},
                {"label": "Pending Vendor Payment", "value": round(vendor_pending, 2), "format": "money", "tone": "amber"},
                {"label": "Collection Rate", "value": round(collection_rate, 1), "format": "percent", "tone": "blue"},
                {"label": "Active Trip Ratio", "value": round(active_trip_ratio, 1), "format": "percent", "tone": "blue"},
            ],
            "kpi_summary": {
                "collection_rate": round(collection_rate, 1),
                "vendor_clearance_rate": round(vendor_clearance_rate, 1),
                "active_trip_ratio": round(active_trip_ratio, 1),
                "profit_margin": round(profit_margin, 1),
            },
            "base_location": BASE_LOCATION,
        }

    def filter_journeys(
        self,
        plate: str = None,
        driver: str = None,
        from_date: date = None,
        to_date: date = None,
        status: str = None,
    ) -> list[dict]:
        """Filter journeys by criteria."""
        results = self.journeys
        
        if plate:
            plate_lower = plate.lower()
            results = [j for j in results if any(v.license_plate.lower().find(plate_lower) != -1 for v in self.vehicles if v.id == j.vehicle_id)]
        
        if driver:
            driver_lower = driver.lower()
            results = [j for j in results if any(d.name.lower().find(driver_lower) != -1 for d in self.drivers if d.id == j.driver_id)]
        
        if from_date:
            results = [j for j in results if j.departure_date >= from_date]
        
        if to_date:
            results = [j for j in results if j.departure_date <= to_date]
        
        if status:
            results = [j for j in results if j.status.lower() == status.lower()]
        
        return [self._journey_to_dict(j) for j in results]


# Global instance
mock_db = MockDatabase()
