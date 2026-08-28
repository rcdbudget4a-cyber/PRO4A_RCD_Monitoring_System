"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Eye, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { type RheRecord } from "./rhe-data";

type RheRole = "administrator" | "unit_user";
type RheModalState = { mode: "new" | "view" | "edit"; record?: RheRecord };

const currency = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
});

const displayDate = (value: string) => value
  ? new Date(`${value}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
  : "";

const nextRecordNo = (records: RheRecord[], year: 2025 | 2026) => {
  const sameYear = records.filter(record => record.year === year);
  // The source workbook restarts its NO. column for each approval batch.
  // Use the actual number of RHE records as the minimum so new entries continue
  // after the full CY list (e.g. CY 2026 has 67 records, so the next is 68).
  return Math.max(
    sameYear.length,
    0,
    ...sameYear.map(record => Number(record.sourceNo) || 0),
  ) + 1;
};

const rheIdOrder = (record: RheRecord) => {
  const match = record.id.match(/^RHE-\d{4}-(\d+)$/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
};

const emptyRheRecord = (records: RheRecord[]): RheRecord => {
  const year = 2026 as const;
  return {
    id: `RHE-${year}-${Date.now()}`,
    year,
    sourceNo: nextRecordNo(records, year),
    name: "",
    unitAssignment: "",
    diagnosis: "",
    procedureDone: "",
    hospital: "",
    dateOfConfinement: "",
    category: "Medical Case",
    amount: 0,
    dateApproved: "",
    dateApprovedDisplay: "",
    remarks: "",
  };
};

export function RhePage({
  records,
  role,
  save,
  remove,
}: {
  records: RheRecord[];
  role: RheRole;
  save: (record: RheRecord, mode: "new" | "edit") => Promise<boolean>;
  remove: (record: RheRecord) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [year, setYear] = useState("All");
  const [modal, setModal] = useState<RheModalState | null>(null);

  const sortedRecords = useMemo(() => [...records].sort((a, b) =>
    a.year - b.year ||
    rheIdOrder(a) - rheIdOrder(b) ||
    a.name.localeCompare(b.name)
  ), [records]);

  // Build a continuous display number per calendar year. This is intentionally
  // separate from sourceNo because the Excel NO. column resets in several batches.
  const displayNumbers = useMemo(() => {
    const counters = new Map<number, number>();
    const numbers = new Map<string, number>();
    for (const record of sortedRecords) {
      const next = (counters.get(record.year) || 0) + 1;
      counters.set(record.year, next);
      numbers.set(record.id, next);
    }
    return numbers;
  }, [sortedRecords]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return sortedRecords.filter(record => {
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
  }, [sortedRecords, query, year]);

  const totalAmount = filtered.reduce((sum, record) => sum + (Number(record.amount) || 0), 0);

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
        {role === "administrator" && (
          <button className="primary" onClick={() => setModal({ mode: "new" })}>
            <Plus />Add Personnel
          </button>
        )}
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
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(record => (
                <tr key={record.id}>
                  <td><strong>CY {record.year}</strong><small>No. {displayNumbers.get(record.id) ?? record.sourceNo}</small></td>
                  <td><strong>{record.name}</strong></td>
                  <td>{record.unitAssignment}</td>
                  <td>{record.diagnosis}</td>
                  <td>{record.procedureDone}</td>
                  <td>{record.hospital}</td>
                  <td>{record.dateOfConfinement}</td>
                  <td><span className="stage">{record.category}</span></td>
                  <td><strong>{currency.format(Number(record.amount) || 0)}</strong></td>
                  <td>{record.dateApprovedDisplay || displayDate(record.dateApproved) || record.dateApproved}</td>
                  <td className="remarks-cell">{record.remarks || "—"}</td>
                  <td>
                    <div className="actions">
                      <button title="View" aria-label={`View RHE record of ${record.name}`} onClick={() => setModal({ mode: "view", record })}><Eye /></button>
                      {role === "administrator" && <button className="edit" title="Edit" aria-label={`Edit RHE record of ${record.name}`} onClick={() => setModal({ mode: "edit", record })}><Pencil /></button>}
                      {role === "administrator" && <button className="delete" title="Delete" aria-label={`Delete RHE record of ${record.name}`} onClick={() => remove(record)}><Trash2 /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && <div className="empty">No matching RHE records found.</div>}
        </div>
      </section>

      {modal && (
        <RheModal
          record={modal.mode === "new" ? null : modal.record || null}
          recordNumber={modal.mode === "new" ? undefined : (modal.record ? displayNumbers.get(modal.record.id) : undefined)}
          mode={modal.mode}
          records={records}
          close={() => setModal(null)}
          save={async record => {
            if (modal.mode === "view") return;
            const ok = await save(record, modal.mode);
            if (ok) setModal(null);
          }}
        />
      )}
    </div>
  );
}

function RheModal({
  record,
  recordNumber,
  mode,
  records,
  close,
  save,
}: {
  record: RheRecord | null;
  recordNumber?: number;
  mode: "new" | "view" | "edit";
  records: RheRecord[];
  close: () => void;
  save: (record: RheRecord) => Promise<void>;
}) {
  const readOnly = mode === "view";
  const [data, setData] = useState<RheRecord>(() => record ? { ...record } : emptyRheRecord(records));
  const field = <K extends keyof RheRecord>(key: K, value: RheRecord[K]) => setData(current => ({ ...current, [key]: value }));

  const changeYear = (year: 2025 | 2026) => {
    setData(current => ({
      ...current,
      year,
      sourceNo: mode === "new" ? nextRecordNo(records, year) : current.sourceNo,
      id: mode === "new" ? `RHE-${year}-${Date.now()}` : current.id,
    }));
  };

  const submit = async () => {
    const normalized: RheRecord = {
      ...data,
      name: data.name.trim(),
      unitAssignment: data.unitAssignment.trim(),
      diagnosis: data.diagnosis.trim(),
      procedureDone: data.procedureDone.trim(),
      hospital: data.hospital.trim(),
      dateOfConfinement: data.dateOfConfinement.trim(),
      category: data.category.trim(),
      amount: Number(data.amount) || 0,
      dateApproved: data.dateApproved.trim(),
      dateApprovedDisplay: data.dateApproved ? displayDate(data.dateApproved) : "",
      remarks: data.remarks.trim(),
    };
    await save(normalized);
  };

  return (
    <div className="modal-bg" onMouseDown={event => event.target === event.currentTarget && close()}>
      <form className="modal panel" onSubmit={event => { event.preventDefault(); if (!readOnly) void submit(); }}>
        <div className="modal-head">
          <div>
            <p>Reimbursement of Hospitalization Expenses</p>
            <h3>{readOnly ? "RHE record details" : mode === "edit" ? "Update RHE personnel record" : "Add new RHE personnel"}</h3>
          </div>
          <button type="button" onClick={close} aria-label="Close"><X /></button>
        </div>
        <fieldset disabled={readOnly} className="plain-fieldset">
          <div className="form-grid">
            <label>Calendar Year
              <select value={data.year} onChange={event => changeYear(Number(event.target.value) as 2025 | 2026)}>
                <option value={2025}>2025</option>
                <option value={2026}>2026</option>
              </select>
            </label>
            <label>Record No.<input readOnly value={String(recordNumber ?? data.sourceNo)} title="Continuous RHE record number for this calendar year" /></label>
            <label className="wide">Rank / Full Name<input required value={data.name} onChange={event => field("name", event.target.value)} placeholder="e.g., PCpl Juan D Dela Cruz" /></label>
            <label>Unit Assignment<input required value={data.unitAssignment} onChange={event => field("unitAssignment", event.target.value)} /></label>
            <label>Category<input required value={data.category} onChange={event => field("category", event.target.value)} placeholder="Medical Case / Surgical Case / Catastrophic Case" /></label>
            <label className="wide">Diagnosis<textarea required rows={3} value={data.diagnosis} onChange={event => field("diagnosis", event.target.value)} /></label>
            <label className="wide">Procedure Done<textarea rows={2} value={data.procedureDone} onChange={event => field("procedureDone", event.target.value)} /></label>
            <label>Hospital<input required value={data.hospital} onChange={event => field("hospital", event.target.value)} /></label>
            <label>Date of Confinement<input required value={data.dateOfConfinement} onChange={event => field("dateOfConfinement", event.target.value)} placeholder="e.g., August 10-15, 2026" /></label>
            <label>Approved Amount<input required type="number" min="0" step="0.01" value={data.amount} onChange={event => field("amount", Number(event.target.value))} /></label>
            <label>Date Approved<input type="date" value={data.dateApproved} onChange={event => field("dateApproved", event.target.value)} /></label>
            <label className="wide">Remarks<textarea rows={3} value={data.remarks} onChange={event => field("remarks", event.target.value)} /></label>
          </div>
        </fieldset>
        <div className="modal-actions">
          <button type="button" className="outline" onClick={close}>{readOnly ? "Close" : "Cancel"}</button>
          {!readOnly && <button className="primary">Save RHE Record</button>}
        </div>
      </form>
    </div>
  );
}
