function DiagnosticResult({ result }) {
  if (!result) {
    return null;
  }

  const confidencePercent = (result.confidence * 100).toFixed(2);

  return (
    <section className="diagnostic-result">
      <h2 className="diagnostic-result-header">Diagnostic Result</h2>

      <div className="diagnostic-result-row">
        <p className="diagnostic-result-label">Predicted Disease</p>
        <p className="diagnostic-result-value">{result.predicted_disease}</p>
      </div>

      <div className="diagnostic-result-row">
        <p className="diagnostic-result-label">Confidence</p>
        <p className="diagnostic-result-value">{confidencePercent}%</p>
      </div>

      <p className="diagnostic-result-status">Analysis Complete</p>
    </section>
  );
}

export default DiagnosticResult;