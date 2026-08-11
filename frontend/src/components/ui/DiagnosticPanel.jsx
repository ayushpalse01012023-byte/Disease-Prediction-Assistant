import { useState } from "react";
import useSymptoms from "../../hooks/useSymptoms";

function DiagnosticPanel({ children }) {
  const { symptoms, loading, error, refetch } = useSymptoms();

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
    // Backend connection to POST /predict will be added in a later step.
  }

  return (
    <section className="diagnostic-panel">
      <h2 className="diagnostic-header">Diagnostic Input</h2>
      <p className="diagnostic-subtitle">Select Observed Symptoms</p>

      {loading && (
        <p className="diagnostic-subtitle">LOADING SYMPTOM DATABASE...</p>
      )}

      {error && !loading && (
        <div className="diagnostic-subtitle">
          <p>{error}</p>
          <button type="button" onClick={refetch}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="symptom-search">
            <input
              type="text"
              className="symptom-search-input"
              placeholder="Search symptoms..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </div>

          <ul className="symptom-results">
            {filteredSymptoms.map((symptom) => (
              <li
                key={symptom}
                className={
                  isSelected(symptom)
                    ? "symptom-option symptom-option-selected"
                    : "symptom-option"
                }
                onClick={() => toggleSymptom(symptom)}
              >
                {symptom}
              </li>
            ))}
          </ul>

          <p className="symptom-count">
            {selectedSymptoms.length} SYMPTOMS SELECTED
          </p>

          <ul className="selected-symptoms">
            {selectedSymptoms.map((symptom) => (
              <li key={symptom} className="selected-symptom">
                {symptom}
                <button
                  type="button"
                  className="selected-symptom-remove"
                  onClick={() => removeSymptom(symptom)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>

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
              disabled={selectedSymptoms.length === 0}
            >
              Run Diagnosis
            </button>
          </div>
        </>
      )}

      {children}
    </section>
  );
}

export default DiagnosticPanel;