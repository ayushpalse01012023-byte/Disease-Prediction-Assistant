import { useState } from "react";

// TEMPORARY symptom list for UI testing only.
// This will later be replaced by the response from GET /symptoms.
const TEMP_SYMPTOMS = [
  "abdominal_pain",
  "acidity",
  "back_pain",
  "cough",
  "itching",
  "skin_rash",
  "vomiting",
  "headache",
];

function DiagnosticPanel({ children }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSymptoms, setSelectedSymptoms] = useState([]);

  // In the future, this will come from the GET /symptoms API response
  // instead of the local TEMP_SYMPTOMS array.
  const availableSymptoms = TEMP_SYMPTOMS;

  const filteredSymptoms = availableSymptoms.filter((symptom) =>
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
    // Backend connection will be added in a later step.
  }

  return (
    <section className="diagnostic-panel">
      <h2 className="diagnostic-header">Diagnostic Input</h2>
      <p className="diagnostic-subtitle">Select Observed Symptoms</p>

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

      {children}
    </section>
  );
}

export default DiagnosticPanel;