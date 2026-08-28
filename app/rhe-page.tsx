"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { rheRecords } from "./rhe-data";

const currency = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

export function RhePage() {
  const [query, setQuery] = useState("");
  const [year, setYear] = useState("All");

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return rheRecords.filter(record => {
      if (year !== "All" && String(record.year) !== year) return false;
      if (!term) return true;
      return [
        record.name,
        record.unitAssignment,
        record.diagnosis,
        record.procedureDone,
        record.hospital,
        record.dateOfConfinement,
        record.category,
        record.dateApprovedDisplay,
        record.remarks,
      ].join(" ").toLowerCase().includes(term);
    });
  }, [query, year]);

  const totalAmount = filtered.reduce((sum, record) => sum + record.amount, 0);

  return (
    <div className="stack">
      <section className="toolbar panel">
        <div className="search">
          <Search />
          <input
            aria-label="Search RHE records"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search name, unit, hospital, category..."
          />
        </div>
        <label className="select">
          <span className="sr-only">RHE year</span>
          <select aria-label="RHE year" value={year} onChange={event => setYear(event.target.value)}>
            <option value="All">All</option>
            <option value="2025">2025</option>
            <option value="2026">2026</option>
          </select>
          <ChevronDown />
        </label>
      </section>

      <section className="panel registry">
        <div className="panel-head">
          <div>
            <h3>Reimbursement of Hospitalization Expenses (RHE)</h3>
            <p>{filtered.length} records • Total approved amount {currency.format(totalAmount)}</p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="retiree-table">
            <thead>
              <tr>
                <th>CY / No.</th>
                <th>Name</th>
                <th>Unit Assignment</th>
                <th>Diagnosis</th>
                <th>Procedure Done</th>
                <th>Hospital</th>
                <th>Date of Confinement</th>
                <th>Category</th>
                <th>Amount</th>
                <th>Date Approved</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(record => (
                <tr key={record.id}>
                  <td><strong>CY {record.year}</strong><small>No. {record.sourceNo}</small></td>
                  <td><strong>{record.name}</strong></td>
                  <td>{record.unitAssignment}</td>
                  <td>{record.diagnosis}</td>
                  <td>{record.procedureDone}</td>
                  <td>{record.hospital}</td>
                  <td>{record.dateOfConfinement}</td>
                  <td><span className="stage">{record.category}</span></td>
                  <td><strong>{currency.format(record.amount)}</strong></td>
                  <td>{record.dateApprovedDisplay || record.dateApproved}</td>
                  <td className="remarks-cell">{record.remarks || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && <div className="empty">No matching RHE records found.</div>}
        </div>
      </section>
    </div>
  );
}
