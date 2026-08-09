"""
main.py

Single-file FastAPI backend for the Disease Prediction Assistant.

Run it with:
    uvicorn main:app --reload

Then open http://127.0.0.1:8000/docs to test it interactively.

Endpoints:
    GET  /            -> health check, confirms API is running
    GET  /symptoms     -> returns the 131 valid symptom names
    POST /predict       -> takes a list of symptoms, returns predicted disease

Place these 3 files in the SAME folder as this script before running:
    - disease_prediction_model.pkl
    - disease_label_encoder.pkl
    - symptom_columns.pkl
"""

import joblib
from pathlib import Path
from typing import List, Optional

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


# ==========================================================================
# 1. LOAD THE SAVED MODEL FILES
# ==========================================================================
# This code runs ONCE, when the server starts (because Python only executes
# top-level module code the first time the file is run/imported). Every
# request afterwards reuses these same objects instead of reloading them.
#
# joblib is used instead of pickle because these files were saved with
# joblib.dump() (common for scikit-learn/XGBoost objects, especially ones
# containing large numpy arrays). Loading them with plain pickle.load()
# raises: _pickle.UnpicklingError: STACK_GLOBAL requires str
#
# BASE_DIR anchors all three paths to the folder that CONTAINS this file,
# not to whatever directory the terminal happens to be in when you run
# "uvicorn main:app". This is what previously caused an OLD symptom_columns.pkl
# (17 legacy "Symptom_1"..."Symptom_17" columns) to be loaded instead of the
# correct, freshly-saved 131-column file.

BASE_DIR = Path(__file__).resolve().parent

MODEL_PATH = BASE_DIR / "disease_prediction_model.pkl"
ENCODER_PATH = BASE_DIR / "disease_label_encoder.pkl"
COLUMNS_PATH = BASE_DIR / "symptom_columns.pkl"

model = joblib.load(MODEL_PATH)                # trained XGBoost model
label_encoder = joblib.load(ENCODER_PATH)      # LabelEncoder for disease names
symptom_columns = joblib.load(COLUMNS_PATH)    # list of 131 symptom names, in training order

# ---- TEMPORARY startup verification -------------------------------------
# Prints to the terminal running "uvicorn main:app" so you can confirm, at a
# glance, exactly which files were loaded and that symptom_columns really
# has 131 entries starting with the correct names. Safe to delete later.
print("Model loaded from:", MODEL_PATH)
print("Encoder loaded from:", ENCODER_PATH)
print("Symptom columns loaded from:", COLUMNS_PATH)
print("Number of symptom columns:", len(symptom_columns))
print("First 10 symptom columns:", symptom_columns[:10])
# ---------------------------------------------------------------------------


# ==========================================================================
# 2. PYDANTIC MODELS (define the shape of request/response JSON)
# ==========================================================================

class SymptomRequest(BaseModel):
    """
    What the frontend sends to POST /predict.

    Example:
    {
        "symptoms": ["itching", "skin_rash", "vomiting"]
    }
    """
    symptoms: List[str] = Field(
        ...,  # "..." means this field is required
        description="A list of symptom names reported by the user."
    )


class PredictionResponse(BaseModel):
    """
    What our API sends back after a successful prediction.

    Example:
    {
        "predicted_disease": "Fungal infection",
        "confidence": 0.98
    }
    """
    predicted_disease: str
    confidence: Optional[float] = None


# ==========================================================================
# 3. CREATE THE APP
# ==========================================================================

app = FastAPI(
    title="Disease Prediction Assistant API",
    description="Backend API that predicts a disease from a list of symptoms.",
    version="1.0.0",
)

# Allow a future frontend (running on a different port/domain) to call this
# API from the browser. For local development we allow all origins ("*").
# In production, replace "*" with your actual frontend URL.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==========================================================================
# 4. ENDPOINTS
# ==========================================================================

@app.get("/")
def read_root():
    """Simple endpoint to confirm the API is alive."""
    return {"message": "Disease Prediction API is running."}


@app.get("/symptoms")
def get_symptoms():
    """
    Returns the exact 131 symptom names the model was trained on.
    The frontend will call this so it never has to hardcode the symptom list.
    """
    return {
        "total_symptoms": len(symptom_columns),
        "symptoms": symptom_columns,
    }


@app.post("/predict", response_model=PredictionResponse)
def predict_disease(request: SymptomRequest):
    """
    Steps:
      1. Validate the incoming symptoms.
      2. Build a 131-length feature vector (0s and 1s).
      3. Run the model to get a prediction.
      4. Decode the prediction back into a disease name.
      5. Return the result as JSON.
    """

    # ---- Step 1a: reject empty symptom lists ----
    if not request.symptoms:
        raise HTTPException(
            status_code=400,
            detail="Symptom list cannot be empty."
        )

    # ---- Step 1b: handle duplicates sensibly by removing them ----
    # e.g. ["itching", "itching", "vomiting"] -> ["itching", "vomiting"]
    unique_symptoms = list(set(request.symptoms))

    # ---- Step 1c: reject any symptom name the model doesn't recognize ----
    unknown_symptoms = [s for s in unique_symptoms if s not in symptom_columns]
    if unknown_symptoms:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unknown symptom(s): {unknown_symptoms}. "
                "Call GET /symptoms to see the list of valid symptom names."
            ),
        )

    # ---- Step 2: build the 131-feature input vector ----
    # Start with every symptom set to 0.
    input_data = {symptom: 0 for symptom in symptom_columns}

    # Set the symptoms the user reported to 1.
    for symptom in unique_symptoms:
        input_data[symptom] = 1

    # Convert to a DataFrame with columns in EXACTLY the same order the
    # model was trained on. This ordering is critical for XGBoost.
    input_df = pd.DataFrame([input_data], columns=symptom_columns)

    # ---- Step 3: run the model ----
    prediction_encoded = model.predict(input_df)[0]

    # ---- Step 4: decode the numeric prediction back into a disease name ----
    predicted_disease = label_encoder.inverse_transform([prediction_encoded])[0]

    # ---- Step 5 (optional): get a confidence score ----
    confidence = None
    if hasattr(model, "predict_proba"):
        probabilities = model.predict_proba(input_df)[0]
        confidence = round(float(max(probabilities)), 4)

    return PredictionResponse(
        predicted_disease=str(predicted_disease),
        confidence=confidence,
    )