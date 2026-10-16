"use client";

import React from "react";
import type { Trip } from "@/types/trip";

interface VisualSummaryProps {
  trips: Trip[];
}

export default function VisualSummary({ trips }: VisualSummaryProps) {
  const total = trips.length || 1;
  const dispatched = trips.filter(t => ["dispatched", "assigned"].includes((t.status || "").toLowerCase())).length;
  const done = trips.filter(t => (t.status || "").toLowerCase() === "done").length;
  const available = trips.filter(t => (t.status || "").toLowerCase() === "available").length;
  const completedTrips = trips.filter(t => t.departure_date && t.arrival_date).length;

  const durationMinutes = trips.reduce((sum, trip) => {
    if (!trip.departure_date || !trip.arrival_date) return sum;
    const start = new Date(trip.departure_date).getTime();
    const end = new Date(trip.arrival_date).getTime();
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return sum;
    return sum + Math.round((end - start) / 60000);
  }, 0);
  const avgJourneyMinutes = completedTrips ? Math.round(durationMinutes / completedTrips) : 0;
  const totalRevenue = trips.reduce((sum, trip) => sum + Number(trip.total_revenue || 0), 0);
  const totalExpense = trips.reduce((sum, trip) => sum + Number(trip.total_expense || 0), 0);
  const avgRevenue = trips.length ? Math.round(totalRevenue / trips.length) : 0;
  const avgProfit = trips.length ? Math.round((totalRevenue - totalExpense) / trips.length) : 0;

  const withinTime = Math.round((done / total) * 100);
  const fleetEfficiency = Math.round(((dispatched + done) / total) * 100);

  const formatMinutes = (minutes: number) => {
    if (!minutes) return "0 min";
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours ? `${hours}h ${mins}m` : `${mins} min`;
  };

  return (
    <div className="visual-summary-grid">
      {/* Fleet Status */}
      <div className="panel visual-card visual-card-large">
        <div className="visual-card-head">
          <div>
            <div className="panel-title">Fleet Status</div>
            <div className="muted" style={{ fontSize: 12 }}>Live journey movement</div>
          </div>
          <span className="visual-chip">DB Live</span>
        </div>
        <div className="visual-card-body">
          <div className="donut-wrap">
            <svg width="118" height="118" viewBox="0 0 110 110">
              <circle cx="55" cy="55" r="48" fill="none" stroke="var(--line)" strokeWidth="14" />
              <circle
                cx="55" cy="55" r="48" fill="none"
                stroke="var(--primary)" strokeWidth="14"
                strokeDasharray={`${fleetEfficiency * 3.01} 301`}
                strokeDashoffset="0"
                transform="rotate(-90 55 55)"
              />
            </svg>
            <div className="donut-center">
              <div style={{ fontSize: 28, fontWeight: 900 }}>{fleetEfficiency}%</div>
              <div className="muted" style={{ fontSize: 11 }}>Efficiency</div>
            </div>
          </div>
          <div className="visual-stat-list">
            <div><span>Total</span><strong>{total}</strong></div>
            <div><span>On the Move</span><strong>{dispatched}</strong></div>
            <div><span>Available</span><strong>{available}</strong></div>
          </div>
        </div>
      </div>

      {/* Delivery Status */}
      <div className="panel visual-card">
        <div className="visual-card-head">
          <div>
            <div className="panel-title">Delivery Status</div>
            <div className="muted" style={{ fontSize: 12 }}>Completed vs in scope</div>
          </div>
        </div>
        <div className="visual-card-body">
          <div className="donut-wrap small">
            <svg width="104" height="104" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="42" fill="none" stroke="var(--line)" strokeWidth="12" />
              <circle
                cx="50" cy="50" r="42" fill="none"
                stroke="var(--secondary)" strokeWidth="12"
                strokeDasharray={`${withinTime * 2.64} 264`}
                strokeDashoffset="0"
                transform="rotate(-90 50 50)"
              />
            </svg>
            <div className="donut-center">
              <div style={{ fontSize: 24, fontWeight: 900, color: "var(--secondary)" }}>{withinTime}%</div>
            </div>
          </div>
          <div className="visual-stat-list compact">
            <div><span>Done</span><strong className="green">{done}</strong></div>
            <div><span>Open</span><strong>{total - done}</strong></div>
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="panel visual-card quick-visual-card">
        {[
          ["Avg Journey Time", formatMinutes(avgJourneyMinutes)],
          ["Avg Revenue", `${avgRevenue.toLocaleString("en-ET")} ETB`],
          ["Avg Profit", `${avgProfit.toLocaleString("en-ET")} ETB`],
        ].map(([label, value]) => (
          <div className="quick-stat-row" key={label}>
            <div className="muted">{label}</div>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
