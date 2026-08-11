import { useState, useEffect, useCallback } from "react";
import { getSymptoms } from "../services/api";

/**
 * useSymptoms
 *
 * Fetches the valid symptom list from the backend (GET /symptoms) and
 * exposes it as React state, along with loading/error status and a
 * refetch function to request the symptoms again on demand.
 */
function useSymptoms() {
  const [symptoms, setSymptoms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchSymptoms = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await getSymptoms();
      setSymptoms(data.symptoms);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSymptoms();
  }, [fetchSymptoms]);

  return {
    symptoms,
    loading,
    error,
    refetch: fetchSymptoms,
  };
}

export default useSymptoms;