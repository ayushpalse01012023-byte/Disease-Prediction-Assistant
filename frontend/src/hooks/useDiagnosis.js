import { useState } from "react";
import { predictDisease } from "../services/api";

/**
 * useDiagnosis
 *
 * Exposes a diagnose(symptoms) function that calls POST /predict and
 * tracks the resulting prediction, loading state, and any error.
 * Does not run automatically — the caller triggers it explicitly.
 */
function useDiagnosis() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function diagnose(symptoms) {
    setLoading(true);
    setError(null);

    try {
      const data = await predictDisease(symptoms);
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return {
    result,
    loading,
    error,
    diagnose,
  };
}

export default useDiagnosis;