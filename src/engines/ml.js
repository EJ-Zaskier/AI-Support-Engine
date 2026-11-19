import { readFileSync } from 'node:fs';
import { CATEGORIES, PRIORITIES } from '../contract.js';
import { MlModelUnavailableError } from '../errors.js';
import { pickResponse } from './responses.js';

/*
 * Motor de Machine Learning (aprendizaje supervisado clásico).
 *
 * El modelo se entrena en Python con scikit-learn (ml/train.py):
 *   TfidfVectorizer(ngram_range=(1, 2), strip_accents="unicode") + LogisticRegression
 * (hiperparámetros elegidos con validación cruzada) y se exporta a ml/model.json. Aquí se replica la inferencia en JavaScript:
 *   1. Preprocesamiento: minúsculas y eliminación de acentos (NFKD).
 *   2. Tokens: secuencias de 2 o más caracteres de palabra (token_pattern de sklearn).
 *   3. Unigramas + bigramas -> conteo -> TF-IDF -> normalización L2.
 *   4. Regresión logística multinomial: puntaje por clase y softmax.
 * Las pruebas verifican que las probabilidades coinciden con las de scikit-learn.
 */

const SKLEARN_TOKEN_PATTERN = '(?u)\\b\\w\\w+\\b';
// Equivalente en JavaScript de (?u)\b\w\w+\b: 2 o más letras, dígitos o guion bajo (Unicode).
const TOKEN_REGEX = /[\p{L}\p{N}_]{2,}/gu;
const COMBINING_MARKS = /\p{Mn}/gu;

function compileModel(spec, allowedLabels, name) {
  const { vectorizer, classifier } = spec ?? {};
  if (!vectorizer || !classifier) throw new Error(`Modelo "${name}" incompleto`);
  if (vectorizer.tokenPattern !== SKLEARN_TOKEN_PATTERN || vectorizer.norm !== 'l2') {
    throw new Error(`Configuración del vectorizador "${name}" no soportada`);
  }
  const unknown = classifier.classes.filter((label) => !allowedLabels.includes(label));
  if (unknown.length > 0) throw new Error(`Etiquetas desconocidas en "${name}": ${unknown.join(', ')}`);

  const size = vectorizer.vocabulary.length;
  const shapeOk =
    vectorizer.idf.length === size &&
    classifier.coef.length === classifier.classes.length &&
    classifier.intercept.length === classifier.classes.length &&
    classifier.coef.every((row) => row.length === size);
  if (!shapeOk) throw new Error(`Dimensiones inconsistentes en el modelo "${name}"`);

  return {
    lowercase: vectorizer.lowercase,
    stripAccents: vectorizer.stripAccents,
    ngramRange: vectorizer.ngramRange,
    sublinearTf: Boolean(vectorizer.sublinearTf),
    index: new Map(vectorizer.vocabulary.map((term, i) => [term, i])),
    idf: Float64Array.from(vectorizer.idf),
    classes: classifier.classes,
    coef: classifier.coef.map((row) => Float64Array.from(row)),
    intercept: classifier.intercept,
  };
}

function preprocess(text, model) {
  let doc = String(text);
  if (model.lowercase) doc = doc.toLowerCase();
  if (model.stripAccents === 'unicode') doc = doc.normalize('NFKD').replace(COMBINING_MARKS, '');
  return doc;
}

function ngrams(tokens, [minN, maxN]) {
  const terms = [];
  for (let n = minN; n <= maxN; n += 1) {
    for (let i = 0; i + n <= tokens.length; i += 1) terms.push(tokens.slice(i, i + n).join(' '));
  }
  return terms;
}

/** Probabilidad por clase, en el mismo orden que model.classes (predict_proba de sklearn). */
export function predictProba(model, text) {
  const tokens = preprocess(text, model).match(TOKEN_REGEX) ?? [];

  const counts = new Map();
  for (const term of ngrams(tokens, model.ngramRange)) {
    const j = model.index.get(term);
    if (j !== undefined) counts.set(j, (counts.get(j) ?? 0) + 1);
  }

  // sublinear_tf de sklearn: tf = 1 + ln(tf)
  const tf = (count) => (model.sublinearTf ? 1 + Math.log(count) : count);
  const weights = [...counts].map(([j, count]) => [j, tf(count) * model.idf[j]]);
  const norm = Math.sqrt(weights.reduce((acc, [, w]) => acc + w * w, 0)) || 1;

  const scores = model.coef.map((row, k) =>
    weights.reduce((acc, [j, w]) => acc + row[j] * (w / norm), model.intercept[k]),
  );
  const max = Math.max(...scores);
  const exps = scores.map((score) => Math.exp(score - max));
  const total = exps.reduce((acc, value) => acc + value, 0);
  return exps.map((value) => value / total);
}

const argmax = (values) => values.reduce((best, value, i) => (value > values[best] ? i : best), 0);
const round = (value) => Math.round(value * 1000) / 1000;

/**
 * Carga y valida ml/model.json. Devuelve null si el archivo no existe
 * (el motor responderá 503 hasta que se entrene el modelo).
 */
export function loadMlModel(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const file = JSON.parse(raw);
  return {
    meta: {
      algorithm: file.algorithm,
      trainedAt: file.trainedAt,
      sklearnVersion: file.sklearnVersion,
      datasetRows: file.dataset?.rows,
      evaluation: file.evaluation,
    },
    category: compileModel(file.models?.category, CATEGORIES, 'category'),
    priority: compileModel(file.models?.priority, PRIORITIES, 'priority'),
    parity: file.parity,
  };
}

export function createMlEngine({ model, reviewThreshold = 0.5 }) {
  return {
    name: 'ml',
    available: Boolean(model),
    info: model ? model.meta : { reason: 'Modelo no entrenado: ejecuta python ml/train.py' },

    async analyze(message) {
      if (!model) throw new MlModelUnavailableError();

      const categoryProbs = predictProba(model.category, message);
      const priorityProbs = predictProba(model.priority, message);
      const c = argmax(categoryProbs);
      const p = argmax(priorityProbs);
      const category = model.category.classes[c];
      const priority = model.priority.classes[p];

      const result = {
        category,
        priority,
        response: pickResponse(category, priority),
        // Baja confianza del modelo => revisión humana.
        requiresHumanReview: category === 'SECURITY' || categoryProbs[c] < reviewThreshold,
        mode: 'ml',
      };

      return {
        result,
        trace: {
          categoryConfidence: round(categoryProbs[c]),
          priorityConfidence: round(priorityProbs[p]),
          categoryProbabilities: Object.fromEntries(
            model.category.classes.map((label, i) => [label, round(categoryProbs[i])]),
          ),
        },
      };
    },
  };
}
