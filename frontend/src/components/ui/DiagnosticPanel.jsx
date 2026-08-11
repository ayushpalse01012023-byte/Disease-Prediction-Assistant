import { useState } from "react";
import useSymptoms from "../../hooks/useSymptoms";
import useDiagnosis from "../../hooks/useDiagnosis";

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
              disabled={selectedSymptoms.length === 0 || diagnosisLoading}
            >
              {diagnosisLoading ? "ANALYZING..." : "Run Diagnosis"}
            </button>
          </div>

          {diagnosisError && (
            <p className="diagnosis-error">{diagnosisError}</p>
          )}

          {result && (
            <div className="diagnosis-result">
              <p className="diagnosis-result-label">Predicted Disease</p>
              <p className="diagnosis-result-value">
                {result.predicted_disease}
              </p>
              <p className="diagnosis-result-label">Confidence</p>
              <p className="diagnosis-result-value">
                {result.confidence}
              </p>
            </div>
          )}
        </>
      )}

      {children}
    </section>
  );
}

export default DiagnosticPanel;