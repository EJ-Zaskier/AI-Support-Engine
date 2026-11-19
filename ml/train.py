"""
Entrenamiento del motor de Machine Learning (aprendizaje supervisado clásico).

Basado en el material "Machine Learning (code)" de la clase:
TF-IDF (unigramas y bigramas) + Regresión Logística con scikit-learn.

Cambios respecto al código base:
  - Se entrenan DOS modelos con el mismo pipeline: uno para la categoría y otro
    para la prioridad (el contrato de la API exige ambas).
  - strip_accents="unicode" para que "sesión" y "sesion" sean el mismo término.
  - Los hiperparámetros (C, class_weight, sublinear_tf) se eligen con validación
    cruzada de 5 particiones SOLO sobre el 80 % de entrenamiento (GridSearchCV).
  - Se evalúa con un 20 % de prueba estratificado (classification_report) y después
    se entrena el modelo final con todo el dataset y los mejores hiperparámetros.
  - El modelo final se exporta a ml/model.json (vocabulario, idf, coeficientes)
    para que la API en Node.js haga la inferencia sin depender de Python.

Uso:
    python ml/train.py
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import sklearn
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report
from sklearn.model_selection import GridSearchCV, StratifiedKFold, train_test_split
from sklearn.pipeline import Pipeline

ROOT = Path(__file__).resolve().parent
DATASET = ROOT / "tickets.csv"
MODEL_OUT = ROOT / "model.json"
REPORT_OUT = ROOT.parent / "evidence" / "ml-entrenamiento.txt"

RANDOM_STATE = 42
TARGETS = ("category", "priority")
EXPECTED_LABELS = {
    "category": {"ACCESS", "BUG", "FEATURE", "SECURITY"},
    "priority": {"LOW", "MEDIUM", "HIGH", "CRITICAL"},
}

# Frases para verificar que la inferencia en Node.js da las mismas probabilidades
# que scikit-learn (no forman parte del dataset ni del benchmark).
PARITY_SAMPLES = [
    "Alguien entró a mi cuenta sin autorización",
    "No puedo iniciar sesión desde ayer",
    "La aplicación se cierra al guardar un documento",
    "Me gustaría que agregaran un modo de vista compacta",
    "Hay una vulnerabilidad de inyección en el formulario de registro",
    "¡¡URGENTE!! el sistema de facturación está caído para todos",
]


PARAM_GRID = {
    "classifier__C": [0.3, 1, 3, 10, 30, 100],
    "classifier__class_weight": [None, "balanced"],
    "vectorizer__sublinear_tf": [False, True],
}


def build_pipeline() -> Pipeline:
    return Pipeline(
        [
            ("vectorizer", TfidfVectorizer(ngram_range=(1, 2), strip_accents="unicode")),
            ("classifier", LogisticRegression(max_iter=2000)),
        ]
    )


def export_pipeline(pipeline: Pipeline) -> dict:
    vectorizer: TfidfVectorizer = pipeline.named_steps["vectorizer"]
    classifier: LogisticRegression = pipeline.named_steps["classifier"]
    vocabulary = sorted(vectorizer.vocabulary_.items(), key=lambda item: item[1])
    return {
        "vectorizer": {
            "lowercase": vectorizer.lowercase,
            "stripAccents": vectorizer.strip_accents,
            "ngramRange": list(vectorizer.ngram_range),
            "tokenPattern": vectorizer.token_pattern,
            "norm": vectorizer.norm,
            "sublinearTf": vectorizer.sublinear_tf,
            "vocabulary": [term for term, _ in vocabulary],
            "idf": [round(float(value), 8) for value in vectorizer.idf_],
        },
        "classifier": {
            "classes": [str(label) for label in classifier.classes_],
            "coef": [[round(float(value), 8) for value in row] for row in classifier.coef_],
            "intercept": [round(float(value), 8) for value in classifier.intercept_],
        },
    }


def main() -> None:
    lines: list[str] = []

    def log(text: str = "") -> None:
        print(text)
        lines.append(text)

    data = pd.read_csv(DATASET)
    data = data.dropna(subset=["message", "category", "priority"])

    for target in TARGETS:
        unknown = set(data[target]) - EXPECTED_LABELS[target]
        if unknown:
            raise ValueError(f"Etiquetas desconocidas en '{target}': {sorted(unknown)}")

    log(f"Entrenamiento: {datetime.now(timezone.utc).isoformat()}")
    log(f"scikit-learn {sklearn.__version__} | pandas {pd.__version__}")
    log(f"Dataset: {DATASET.name} con {len(data)} solicitudes")
    log("")
    log("Distribución por categoría:")
    log(data["category"].value_counts().to_string())
    log("")
    log("Distribución por prioridad:")
    log(data["priority"].value_counts().to_string())

    exported: dict[str, dict] = {}
    evaluation: dict[str, dict] = {}
    final_models: dict[str, Pipeline] = {}

    for target in TARGETS:
        # Igual que el código de la clase: 80/20 estratificado.
        X_train, X_test, y_train, y_test = train_test_split(
            data["message"],
            data[target],
            test_size=0.2,
            stratify=data[target],
            random_state=RANDOM_STATE,
        )
        # Línea base: el pipeline de la clase con hiperparámetros por defecto.
        baseline = build_pipeline().fit(X_train, y_train)
        baseline_accuracy = accuracy_score(y_test, baseline.predict(X_test))

        # Ajuste de hiperparámetros con validación cruzada sobre el entrenamiento.
        search = GridSearchCV(
            build_pipeline(),
            PARAM_GRID,
            cv=StratifiedKFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE),
            scoring="accuracy",
            n_jobs=-1,
        )
        search.fit(X_train, y_train)
        best_params = search.best_params_
        predictions = search.predict(X_test)

        accuracy = accuracy_score(y_test, predictions)
        evaluation[target] = {
            "testSize": int(len(X_test)),
            "baselineAccuracy": round(float(baseline_accuracy), 4),
            "cvAccuracy": round(float(search.best_score_), 4),
            "accuracy": round(float(accuracy), 4),
            "bestParams": {key.split("__")[1]: value for key, value in best_params.items()},
        }
        log("")
        log(f"=== Modelo de {target} (evaluación con {len(X_test)} solicitudes de prueba) ===")
        log(f"Línea base (código de la clase, C=1): exactitud {baseline_accuracy:.3f}")
        log(f"Mejores hiperparámetros (validación cruzada 5-fold, {search.best_score_:.3f}): {best_params}")
        log(classification_report(y_test, predictions, zero_division=0))

        # Modelo final: mejores hiperparámetros, entrenado con todo el dataset.
        final_model = build_pipeline().set_params(**best_params).fit(data["message"], data[target])
        final_models[target] = final_model
        exported[target] = export_pipeline(final_model)

    example = "Alguien entró a mi cuenta sin autorización"
    log(f'Ejemplo de la clase: "{example}"')
    log(f"  categoría -> {final_models['category'].predict([example])[0]}")
    log(f"  prioridad -> {final_models['priority'].predict([example])[0]}")

    parity = {
        target: {
            "samples": PARITY_SAMPLES,
            "probabilities": [
                [round(float(p), 8) for p in row]
                for row in final_models[target].predict_proba(PARITY_SAMPLES)
            ],
        }
        for target in TARGETS
    }

    model_file = {
        "version": 1,
        "algorithm": "TF-IDF (1-2 gramas) + Regresión Logística",
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "sklearnVersion": sklearn.__version__,
        "dataset": {"file": DATASET.name, "rows": int(len(data))},
        "evaluation": evaluation,
        "models": exported,
        "parity": parity,
    }
    MODEL_OUT.write_text(json.dumps(model_file, ensure_ascii=False), encoding="utf-8")
    log("")
    log(f"Modelo exportado a {MODEL_OUT.relative_to(ROOT.parent).as_posix()}")

    REPORT_OUT.parent.mkdir(parents=True, exist_ok=True)
    REPORT_OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
