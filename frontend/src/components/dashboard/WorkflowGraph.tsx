"use client";
import { normalizeState, stateLabel, percentOf, money } from "@/lib/formatters";
import type { Trip } from "@/types/trip";
import type { DashboardSnapshot } from "@/types/dashboard";

interface WorkflowGraphProps {
  data: DashboardSnapshot;
  allTrips: Trip[];
  onOpenView: (view: string, status?: string) => void;
}

const ALL_STATES = ["draft", "available", "assigned", "dispatched", "done", "cancelled"];

export default function WorkflowGraph({ data, allTrips, onOpenView }: WorkflowGraphProps) {
  // Build state counts
  const stateCounts: Record<string, number> = Object.fromEntries(
    ALL_STATES.map((s) => [s, 0])
  );
  allTrips.forEach((t) => {
    const s = normalizeState(t.status);
    if (s in stateCounts) stateCounts[s]++;
  });
  if (Array.isArray(data.journeys_by_status)) {
    data.journeys_by_status.forEach((item) => {
      const s = normalizeState(item.state || item.status);
      if (s in stateCounts && Number(item.count || 0) > stateCounts[s]) {
        stateCounts[s] = Number(item.count || 0);
      }
    });
  }

  const payment = data.payment_summary ?? {};
  const maxState = Math.max(1, ...Object.values(stateCounts));

  const paymentRows: [string, number, number, string][] = [
    ["Customer Paid", Number(payment.customer_paid_total || 0), Number(payment.receivable_total || 0), "green"],
    ["Customer Pending", Number(payment.customer_pending_total || 0), Number(payment.receivable_total || 0), "red"],
    ["Vendor Paid", Number(payment.vendor_paid_total || 0), Number(payment.payment_request_total || payment.expense_total || 0), "green"],
    ["Vendor Pending", Number(payment.vendor_pending_total || 0), Number(payment.payment_request_total || payment.expense_total || 0), "amber"],
  ];

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Workflow pipeline */}
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Journey Pipeline</div>
        </div>
        <div className="panel-body">
          <div id="workflow-graph">
            <div className="workflow">
              {ALL_STATES.map((state) => (
                <button
                  key={state}
                  type="button"
                  className={`workflow-step${stateCounts[state] ? " active" : ""}`}
                  data-open-view="trips"
                  data-status={state}
                  onClick={() => onOpenView("trips", state)}
                >
                  <div className="workflow-label">{stateLabel(state)}</div>
                  <div className="workflow-value">{stateCounts[state]}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
        {/* Payment chart */}
        {/* Payment chart */}
        <div className="panel">
          <div className="panel-header"><div className="panel-title">Payment Flow</div></div>
          <div className="panel-body">
            <div id="payment-chart">
              <div className="bar-list">
                {paymentRows.map(([label, value, total, tone]) => (
                  <div
                    key={label}
                    className="bar-row"
                  >
                    <div className="bar-head">
                      <span>{label}</span>
                      <strong>{money(value)}</strong>
                    </div>
                    <div className="bar-track">
                      <div
                        className={`bar-fill ${tone}`}
                        style={{ width: `${percentOf(value, total)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Status chart */}
        <div className="panel">
          <div className="panel-header"><div className="panel-title">Status Breakdown</div></div>
          <div className="panel-body">
            <div id="status-chart">
              <div className="bar-list">
                {ALL_STATES.map((state) => (
                  <button
                    key={state}
                    type="button"
                    className="bar-row"
                    data-open-view="trips"
                    data-status={state}
                    onClick={() => onOpenView("trips", state)}
                  >
                    <div className="bar-head">
                      <span>{stateLabel(state)}</span>
                      <strong>{stateCounts[state]}</strong>
                    </div>
                    <div className="bar-track">
                      <div
                        className="bar-fill"
                        style={{ width: `${percentOf(stateCounts[state], maxState)}%` }}
                      />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
