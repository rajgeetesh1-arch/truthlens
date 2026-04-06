import sys
import json
import torch
from transformers import DistilBertTokenizerFast, DistilBertForSequenceClassification
import os

# ── Load model ────────────────────────────────────────
MODEL_PATH = os.path.join(os.path.dirname(__file__), "model")

try:
    tokenizer = DistilBertTokenizerFast.from_pretrained(MODEL_PATH)
    model = DistilBertForSequenceClassification.from_pretrained(MODEL_PATH)
    model.eval()
except Exception as e:
    print(json.dumps({"error": f"Model load failed: {str(e)}"}))
    sys.exit(1)

# ── Predict ───────────────────────────────────────────
def predict(text):
    try:
        inputs = tokenizer(
            text,
            return_tensors="pt",
            truncation=True,
            padding=True,
            max_length=128
        )
        with torch.no_grad():
            outputs = model(**inputs)
            probs   = torch.softmax(outputs.logits, dim=1)[0]
            fake_prob = probs[0].item()
            real_prob = probs[1].item()

        ml_score = round(real_prob * 100, 2)

        return {
            "ml_score":   ml_score,
            "ml_verdict": "REAL" if ml_score >= 50 else "FAKE",
            "confidence": round(max(fake_prob, real_prob) * 100, 2),
            "fake_prob":  round(fake_prob * 100, 2),
            "real_prob":  round(real_prob * 100, 2)
        }
    except Exception as e:
        return {"error": str(e)}

# ── Main ──────────────────────────────────────────────
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No text provided"}))
        sys.exit(1)

    text   = sys.argv[1]
    result = predict(text)
    print(json.dumps(result))