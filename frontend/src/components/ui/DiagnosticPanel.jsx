function DiagnosticPanel({ children }) {
  return (
    <section className="diagnostic-panel">
      <h2>Diagnostic Input</h2>
      <p>Symptoms will be entered here.</p>
      {children}
    </section>
  );
}

export default DiagnosticPanel;