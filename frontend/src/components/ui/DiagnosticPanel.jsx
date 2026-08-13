import { useState } from "react";
import useSymptoms from "../../hooks/useSymptoms";
import useDiagnosis from "../../hooks/useDiagnosis";
import DiagnosticResult from "./DiagnosticResult";

function DiagnosticPanel({ children }) {
  const { symptoms, loading, error, refetch } = useSymptoms();

  const {
    result,
    loading: diagnosisLoading,
    error: diagnosisError,
    diagnose,
  } = useDiagnosis();

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSymptoms, setSelectedSymptoms] = useState([]);

  const filteredSymptoms = symptoms.filter((symptom) =>
    symptom.toLowerCase().includes(searchTerm.toLowerCase())
  );

  function isSelected(symptom) {
    return selectedSymptoms.includes(symptom);
  }

  function toggleSymptom(symptom) {
    setSelectedSymptoms((prev) =>
      prev.includes(symptom)
        ? prev.filter((item) => item !== symptom)
        : [...prev, symptom]
    );
  }

  function removeSymptom(symptom) {
    setSelectedSymptoms((prev) => prev.filter((item) => item !== symptom));
  }

  function clearSymptoms() {
    setSelectedSymptoms([]);
  }

  function handleRunDiagnosis() {
    diagnose(selectedSymptoms);
  }

  return (
    <section className="diagnostic-panel">
      <header className="diagnostic-console-header">
        <p className="console-eyebrow">Diagnostic Interface // 04</p>
        <h2 className="diagnostic-header">Diagnostic Input</h2>
        <p className="diagnostic-subtitle">Select Observed Symptoms</p>
      </header>

      {loading && (
        <div className="console-state console-state-loading">
          <span className="console-state-marker" aria-hidden="true" />
          <p className="console-state-text">Loading Symptom Database…</p>
        </div>
      )}

      {error && !loading && (
        <div className="console-state console-state-error">
          <span className="console-state-marker" aria-hidden="true" />
          <p className="console-state-text">{error}</p>
          <button
            type="button"
            className="console-retry"
            onClick={refetch}
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="symptom-search">
            <span className="symptom-search-marker" aria-hidden="true" />
            <input
              type="text"
              className="symptom-search-input"
              placeholder="Search symptom index…"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              aria-label="Search symptoms"
            />
          </div>

          <ul
            className="symptom-results"
            role="listbox"
            aria-label="Available symptoms"
          >
            {filteredSymptoms.map((symptom) => (
              <li
                key={symptom}
                role="option"
                aria-selected={isSelected(symptom)}
                tabIndex={0}
                className={
                  isSelected(symptom)
                    ? "symptom-option symptom-option-selected"
                    : "symptom-option"
                }
                onClick={() => toggleSymptom(symptom)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    toggleSymptom(symptom);
                  }
                }}
              >
                <span className="symptom-option-marker" aria-hidden="true" />
                <span className="symptom-option-label">{symptom}</span>
              </li>
            ))}

            {filteredSymptoms.length === 0 && (
              <li className="symptom-results-empty">No matching symptoms</li>
            )}
          </ul>

          <div className="symptom-array-header">
            <p className="symptom-count">
              {selectedSymptoms.length} Symptoms Selected
            </p>
          </div>

          {selectedSymptoms.length > 0 && (
            <ul className="selected-symptoms">
              {selectedSymptoms.map((symptom) => (
                <li key={symptom} className="selected-symptom">
                  <span
                    className="selected-symptom-marker"
                    aria-hidden="true"
                  />
                  <span className="selected-symptom-label">{symptom}</span>
                  <button
                    type="button"
                    className="selected-symptom-remove"
                    onClick={() => removeSymptom(symptom)}
                    aria-label={`Remove ${symptom}`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="diagnosis-actions">
            <button
              type="button"
              className="clear-symptoms"
              onClick={clearSymptoms}
              disabled={selectedSymptoms.length === 0}
            >
              Clear
            </button>
            <button
              type="button"
              className="run-diagnosis"
              onClick={handleRunDiagnosis}
              disabled={selectedSymptoms.length === 0 || diagnosisLoading}
            >
              <span className="run-diagnosis-marker" aria-hidden="true" />
              {diagnosisLoading ? "Analyzing…" : "Run Diagnosis"}
            </button>
          </div>

          {diagnosisLoading && (
            <div className="console-state console-state-computing">
              <span className="console-state-marker" aria-hidden="true" />
              <p className="console-state-text">
                Processing diagnostic inference…
              </p>
            </div>
          )}

          {diagnosisError && !diagnosisLoading && (
            <div className="console-state console-state-error">
              <span className="console-state-marker" aria-hidden="true" />
              <p className="console-state-text">{diagnosisError}</p>
            </div>
          )}

          <DiagnosticResult result={result} />
        </>
      )}

      {children}
    </section>
  );
}

export default DiagnosticPanel;