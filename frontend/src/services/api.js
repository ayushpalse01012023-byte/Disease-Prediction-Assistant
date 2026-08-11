/**
 * api.js
 *
 * Service module for communicating with the Disease Prediction Assistant
 * FastAPI backend. This file only defines the API base URL and the
 * request functions themselves — nothing here is called automatically,
 * and no UI or React state lives in this file.
 */

export const API_BASE_URL = "http://127.0.0.1:8000";

/**
 * Fetches the list of valid symptom names from the backend.
 *
 * Calls: GET /symptoms
 * Returns: { total_symptoms: number, symptoms: string[] }
 */
export async function getSymptoms() {
  const response = await fetch(`${API_BASE_URL}/symptoms`);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch symptoms. Server responded with status ${response.status}.`
    );
  }

  return response.json();
}

/**
 * Sends a list of symptoms to the backend and returns the predicted disease.
 *
 * Calls: POST /predict
 * Body: { "symptoms": string[] }
 * Returns: { predicted_disease: string, confidence: number }
 */
export async function predictDisease(symptoms) {
  const response = await fetch(`${API_BASE_URL}/predict`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ symptoms }),
  });

  if (!response.ok) {
    throw new Error(
      `Prediction request failed. Server responded with status ${response.status}.`
    );
  }

  return response.json();
}