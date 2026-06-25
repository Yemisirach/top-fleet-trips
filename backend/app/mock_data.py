"""In-memory mock database with seeded demo data for Topwater Ethiopia journey tracking."""

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
class MockTimelineEntry:
    timestamp: datetime
    location: str
    source: str  # 'GPS' | 'Odoo' | 'Supervisor'
    discrepancy_flag: bool
    note: str

@dataclass
class MockJourney:
    id: int
    vehicle_id: int
    driver_id: int
    origin: str
    destinations: list[str]
    departure_date: date
    return_date: Optional[date]
    status: str  # planned, in_progress, completed, cancelled
    total_revenue: float
    total_expense: float
    fuel_cost: float
    driver_allowance: float
    tolls: float
    maintenance: float
    other_expense: float
    cargo_type: str
    cargo_weight_kg: float
    distance_km: int
    timeline: list[MockTimelineEntry] = field(default_factory=list)


# ------------------------------------------------------------------------------
# Seeding helpers
# ------------------------------------------------------------------------------

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

# Base location
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
            self.vehicles.append(
                MockVehicle(
                    id=10000 + i,
                    license_plate=f"TOP-{random.randint(1000, 9999)}-{chr(65+random.randint(0,25))}{chr(65+random.randint(0,25))}",
                    model=model,
                    brand=brand,
                    fuel_type=random.choice(FUEL_TYPES),
                    driver_id=random.choice(self.drivers).id if random.random() > 0.2 else None,
                    state_id=None,
                    active=True,
                )
            )

    def _seed_journeys(self):
        """Generate realistic round-trip journeys from Topwater base."""
        self.journeys = []
        now = datetime(2026, 6, 24)
        for i in range(120):
            vehicle = random.choice(self.vehicles)
            driver = random.choice(self.drivers)
            dest = random.choice(DESTINATIONS)
            cargo = random.choice(CARGO_TYPES)
            cargo_weight = random.randint(500, 20000)
            distance = random.randint(200, 1800)
            
            # Calculate dates: round trip takes 1-7 days typically
            dep_date = now + timedelta(days=random.randint(-90, 30))
            trip_duration = random.randint(1, max(1, distance // 300))
            ret_date = dep_date + timedelta(days=trip_duration)
            
            status_weights = [15, 35, 40, 5]
            status = random.choices(STATUS_CHOICES, weights=status_weights)[0]
            
            # Revenue based on distance and cargo
            base_rate = random.uniform(15, 35)  # per km
            revenue = distance * base_rate + (cargo_weight / 1000) * random.uniform(50, 150)
            
            # Expenses
            fuel_cost = distance * random.uniform(1.5, 3.0)  # birr per km
            driver_allowance = trip_duration * random.uniform(500, 1500)
            tolls = random.uniform(0, 5000) if distance > 500 else 0
            maintenance = random.uniform(500, 3000)
            other = random.uniform(200, 2000)
            total_expense = fuel_cost + driver_allowance + tolls + maintenance + other
            
            journey = MockJourney(
                id=200000 + i,
                vehicle_id=vehicle.id,
                driver_id=driver.id,
                origin=BASE_LOCATION,
                destinations=[dest],
                departure_date=dep_date.date(),
                return_date=ret_date.date() if status == "completed" else (ret_date.date() if status == "in_progress" and random.random() > 0.5 else None),
                status=status,
                total_revenue=round(revenue, 2),
                total_expense=round(total_expense, 2),
                fuel_cost=round(fuel_cost, 2),
                driver_allowance=round(driver_allowance, 2),
                tolls=round(tolls, 2),
                maintenance=round(maintenance, 2),
                other_expense=round(other, 2),
                cargo_type=cargo,
                cargo_weight_kg=cargo_weight,
                distance_km=distance,
            )
            
            # Generate timeline for this journey
            journey.timeline = self._generate_journey_timeline(journey, dest)
            self.journeys.append(journey)
        
        # Sort by departure date descending
        self.journeys.sort(key=lambda j: j.departure_date, reverse=True)

    def _generate_journey_timeline(self, journey: MockJourney, dest: str) -> list[MockTimelineEntry]:
        """Generate realistic timeline for a round-trip journey."""
        timeline: list[MockTimelineEntry] = []
        
        # 1. Departure from Topwater base
        timeline.append(
            MockTimelineEntry(
                timestamp=datetime.combine(journey.departure_date, datetime.min.time()).replace(hour=6 + random.randint(0, 2)),
                location=BASE_LOCATION,
                source="Odoo",
                discrepancy_flag=False,
                note="Journey departed from Topwater Ethiopia HQ",
            )
        )
        
        # 2. GPS waypoints during outbound journey
        if journey.status in ("in_progress", "completed"):
            num_waypoints = random.randint(2, 4)
            for j in range(num_waypoints):
                hour_offset = random.randint(3, 18)
                day_offset = random.randint(0, max(0, ((journey.return_date or journey.departure_date) - journey.departure_date).days)) if journey.return_date else 0
                waypoint_time = datetime.combine(journey.departure_date, datetime.min.time()).replace(hour=6) + timedelta(days=day_offset, hours=hour_offset)
                
                # Progress-based location
                if j < num_waypoints - 1:
                    location = random.choice(["Checkpoint", "Rest Stop", " Fuel Station", "Highway Marker"])
                else:
                    location = dest
                
                discrepancy = random.random() < 0.25
                
                timeline.append(
                    MockTimelineEntry(
                        timestamp=waypoint_time,
                        location=location,
                        source="GPS",
                        discrepancy_flag=discrepancy,
                        note="GPS tracking active" if not discrepancy else "GPS vs Odoo discrepancy detected",
                    )
                )
            
            # 3. Arrival at destination
            if journey.status in ("in_progress", "completed"):
                timeline.append(
                    MockTimelineEntry(
                        timestamp=datetime.combine(journey.departure_date, datetime.min.time()).replace(hour=14 + random.randint(0, 4)) + timedelta(days=max(0, ((journey.return_date or journey.departure_date) - journey.departure_date).days // 2)),
                        location=dest,
                        source="Odoo",
                        discrepancy_flag=False,
                        note="Arrived at destination - unloading cargo",
                    )
                )
            
            # 4. Supervisor check-in at destination
            if random.random() < 0.4:
                timeline.append(
                    MockTimelineEntry(
                        timestamp=datetime.combine(journey.departure_date, datetime.min.time()).replace(hour=16) + timedelta(days=max(0, ((journey.return_date or journey.departure_date) - journey.departure_date).days // 2)),
                        location=dest,
                        source="Supervisor",
                        discrepancy_flag=False,
                        note="Supervisor verification at destination",
                    )
                )
            
            # 5. Return journey GPS waypoints
            if journey.status == "completed" and journey.return_date:
                num_return_wp = random.randint(1, 3)
                for j in range(num_return_wp):
                    hour_offset = random.randint(4, 16)
                    return_start = journey.return_date or journey.departure_date
                    waypoint_time = datetime.combine(return_start, datetime.min.time()).replace(hour=6) + timedelta(hours=hour_offset)
                    location = random.choice(["Checkpoint", "Rest Stop", "Fuel Station"])
                    discrepancy = random.random() < 0.25
                    
                    timeline.append(
                        MockTimelineEntry(
                            timestamp=waypoint_time,
                            location=location,
                            source="GPS",
                            discrepancy_flag=discrepancy,
                            note="Return journey GPS tracking",
                        )
                    )
                
                # 6. Return to Topwater base
                timeline.append(
                    MockTimelineEntry(
                        timestamp=datetime.combine(journey.return_date, datetime.min.time()).replace(hour=14 + random.randint(0, 4)),
                        location=BASE_LOCATION,
                        source="Odoo",
                        discrepancy_flag=False,
                        note="Returned to Topwater Ethiopia HQ - journey complete",
                    )
                )
        
        # Sort by timestamp
        timeline.sort(key=lambda x: x.timestamp)
        return timeline

    # ---------------------------------------------------------------------------
    # Query methods
    # ---------------------------------------------------------------------------

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

    def _journey_to_dict(self, j: MockJourney) -> dict:
        vehicle = next((v for v in self.vehicles if v.id == j.vehicle_id), None)
        driver = next((d for d in self.drivers if d.id == j.driver_id), None)
        profit = j.total_revenue - j.total_expense
        return {
            "id": j.id,
            "vehicle_plate": vehicle.license_plate if vehicle else "Unknown",
            "vehicle_brand": vehicle.brand if vehicle else "Unknown",
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
            "fuel_cost": j.fuel_cost,
            "driver_allowance": j.driver_allowance,
            "tolls": j.tolls,
            "maintenance": j.maintenance,
            "other_expense": j.other_expense,
            "cargo_type": j.cargo_type,
            "cargo_weight_kg": j.cargo_weight_kg,
            "distance_km": j.distance_km,
        }

    def get_journey_detail(self, journey_id: int) -> Optional[dict]:
        journey = next((j for j in self.journeys if j.id == journey_id), None)
        if not journey:
            return None
        return self._journey_to_dict(journey)

    def get_journey_timeline(self, journey_id: int) -> Optional[list[dict]]:
        journey = next((j for j in self.journeys if j.id == journey_id), None)
        if not journey:
            return None
        return [
            {
                "timestamp": entry.timestamp.isoformat(),
                "location": entry.location,
                "source": entry.source,
                "discrepancy_flag": entry.discrepancy_flag,
                "note": entry.note,
            }
            for entry in journey.timeline
        ]

    def get_full_dashboard(self) -> dict:
        """Return everything the dashboard needs in one call."""
        total_revenue = sum(j.total_revenue for j in self.journeys)
        total_expense = sum(j.total_expense for j in self.journeys)
        active_count = sum(1 for j in self.journeys if j.status in ("planned", "in_progress"))
        return {
            "summary": self.get_summary(),
            "vehicles_by_brand": self.get_vehicles_by_brand(),
            "journeys_by_status": self.get_journeys_by_status(),
            "recent_journeys": self.get_recent_journeys(20),
            "active_journey_count": active_count,
            "total_revenue": total_revenue,
            "total_expense": total_expense,
            "total_profit": round(total_revenue - total_expense, 2),
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