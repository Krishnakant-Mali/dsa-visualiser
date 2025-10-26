import React, { useState, useEffect } from 'react';
import * as Babel from '@babel/standalone';
import arrayPlugin from './instrumentation';
import './App.css';
import { Play, RefreshCw } from 'lucide-react';

export default function App() {
  const [code, setCode] = useState(`// your code here`);
  const [rawInput, setRawInput] = useState('hello world');
  const [vizDelay, setVizDelay] = useState(500);
  const [history, setHistory] = useState([]);
  const [step, setStep] = useState(0);

  const delay = ms => new Promise(res => setTimeout(res, ms));
  const clone = o => JSON.parse(JSON.stringify(o));

  const run = async () => {
    const snaps = [];
    const tokens = rawInput.trim().split(/\s+/).map(x => isNaN(x) ? x : Number(x));
    let buf = [...tokens];
    window.readInput = () => buf.shift();

    window.__vizArrays = {};
    window.__vizVars = {};
    window.__viz = {
      createArray(data, name) {
        const arr = Array.isArray(data) ? [...data] : new Array(data).fill(null);
        window.__vizArrays[name] = arr;
        snaps.push(clone({ arrays: window.__vizArrays, vars: window.__vizVars }));
        return arr;
      },
      setArrayElement(n, i, v) {
        window.__vizArrays[n][i] = v;
        snaps.push(clone({ arrays: window.__vizArrays, vars: window.__vizVars }));
      },
      refreshArray(n) {
        snaps.push(clone({ arrays: window.__vizArrays, vars: window.__vizVars }));
      },
      createString(val, name) {
        const s = String(val);
        window.__vizVars[name] = s;
        window.__vizArrays[name] = s.split('');
        snaps.push(clone({ arrays: window.__vizArrays, vars: window.__vizVars }));
        return s;
      },
      updateString(name, newVal) {
        window.__vizVars[name] = newVal;
        window.__vizArrays[name] = String(newVal).split('');
        snaps.push(clone({ arrays: window.__vizArrays, vars: window.__vizVars }));
        return newVal;
      },
      createVar(val, name) {
        window.__vizVars[name] = val;
        snaps.push(clone({ arrays: window.__vizArrays, vars: window.__vizVars }));
        return val;
      },
      updateVar(name, newVal) {
        window.__vizVars[name] = newVal;
        snaps.push(clone({ arrays: window.__vizArrays, vars: window.__vizVars }));
        return newVal;
      }
    };

    const { code: transformed } = Babel.transform(code, { plugins: [arrayPlugin] });
    eval(transformed);

    setHistory(snaps);
    setStep(0);
    for (let i = 0; i < snaps.length; i++) {
      setStep(i);
      // eslint-disable-next-line no-await-in-loop
      await delay(vizDelay);
    }
  };

  const current = history[step] || { arrays: {}, vars: {} };

  return (
    <div className="App">
      {/* Top editor & input */}
      <div className="editor-container">
        <div className="code-editor">
          <label>Code</label>
          <textarea
            className="code-input"
            rows={15}
            value={code}
            onChange={e => setCode(e.target.value)}
          />
        </div>
        <div className="input-run">
          <label>Input (space-separated)</label>
          <textarea
            className="code-input"
            rows={2}
            value={rawInput}
            onChange={e => setRawInput(e.target.value)}
          />
          <label>Delay (ms)</label>
          <input
            type="number"
            className="delay-input"
            value={vizDelay}
            onChange={e => setVizDelay(+e.target.value)}
          />
          <button className="run-btn" onClick={run}>
            <Play size={16} /> Run
          </button>
          {history.length > 0 && (
            <div className="status">
              <RefreshCw size={14} className="status-icon" />
              Step {step + 1} <span className="of">of</span> {history.length}
            </div>
          )}
        </div>
      </div>

      {/* Visualization & Variables */}
      <div className="viz-container">
        <aside className="vars-panel">
          <h3>Variables</h3>
          <ul>
            {Object.entries(current.vars).map(([k, v]) => (
              <li key={k}>
                <code>{k}</code> = <code>{String(v)}</code>
              </li>
            ))}
          </ul>
        </aside>
        <section className="arrays-panel">
          {Object.entries(current.arrays).map(([name, arr]) => (
            <div key={name} className="array-block">
              <h3>{name}</h3>
              <div className="array-view">
                {arr.map((v, i) => (
                  <div key={i} className="cell">
                    <div className="index">{i}</div>
                    <div className="value">{v === null ? '∅' : v}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
