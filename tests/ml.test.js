import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { AnalysisResultSchema } from '../src/contract.js';
import { createMlEngine, loadMlModel, predictProba } from '../src/engines/ml.js';
import { MlModelUnavailableError } from '../src/errors.js';

const MODEL_PATH = fileURLToPath(new URL('../ml/model.json', import.meta.url));
const model = loadMlModel(MODEL_PATH);

describe('Motor de Machine Learning', () => {
  test('el modelo entrenado existe y tiene las etiquetas del contrato', () => {
    assert.ok(model, 'ml/model.json debe existir (python ml/train.py)');
    assert.deepEqual([...model.category.classes].sort(), ['ACCESS', 'BUG', 'FEATURE', 'SECURITY']);
    assert.deepEqual([...model.priority.classes].sort(), ['CRITICAL', 'HIGH', 'LOW', 'MEDIUM']);
  });

  test('la inferencia en Node coincide con predict_proba de scikit-learn', () => {
    for (const target of ['category', 'priority']) {
      const { samples, probabilities } = model.parity[target];
      samples.forEach((sample, i) => {
        const fromNode = predictProba(model[target], sample);
        fromNode.forEach((p, k) => {
          const expected = probabilities[i][k];
          assert.ok(Math.abs(p - expected) < 1e-5, `${target} / "${sample}" / clase ${k}: ${p} vs ${expected}`);
        });
      });
    }
  });

  test('cumple el contrato de salida con mode=ml', async () => {
    const { result, trace } = await createMlEngine({ model }).analyze('La aplicación se congela al subir una foto');
    assert.ok(AnalysisResultSchema.safeParse(result).success);
    assert.equal(result.mode, 'ml');
    assert.ok(trace.categoryConfidence > 0 && trace.categoryConfidence <= 1);
  });

  test('marca revisión humana cuando la confianza es menor al umbral', async () => {
    const { result } = await createMlEngine({ model, reviewThreshold: 1.01 }).analyze('Me gustaría un modo compacto');
    assert.equal(result.requiresHumanReview, true);
  });

  test('responde 503 si el modelo no está entrenado', async () => {
    assert.equal(loadMlModel(path.join(os.tmpdir(), 'no-existe', 'model.json')), null);
    const engine = createMlEngine({ model: null });
    assert.equal(engine.available, false);
    await assert.rejects(engine.analyze('hola'), MlModelUnavailableError);
  });

  test('rechaza un modelo alterado con etiquetas fuera del catálogo', () => {
    const file = JSON.parse(readFileSync(MODEL_PATH, 'utf8'));
    file.models.category.classifier.classes[0] = 'BILLING';
    const tampered = path.join(os.tmpdir(), `model-alterado-${process.pid}.json`);
    writeFileSync(tampered, JSON.stringify(file));
    assert.throws(() => loadMlModel(tampered), /Etiquetas desconocidas/);
  });
});
