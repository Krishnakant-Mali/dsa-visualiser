// instrumentation.js
export default function arrayPlugin({ types: t }) {
  const mutatingMethods = [
    'push','pop','shift','unshift',
    'splice','sort','reverse',
    'fill','copyWithin'
  ];

  function isVizCall(path) {
    if (!path.isCallExpression()) return false;
    const callee = path.node.callee;
    return (
      t.isMemberExpression(callee) &&
      t.isMemberExpression(callee.object) &&
      t.isIdentifier(callee.object.object, { name: 'window' }) &&
      t.isIdentifier(callee.object.property, { name: '__viz' })
    );
  }

  return {
    visitor: {
      VariableDeclarator(path) {
        const init = path.node.init;
        const name = path.node.id.name;

        // wrap readInput()
        if (
          t.isCallExpression(init) &&
          t.isIdentifier(init.callee, { name: 'readInput' })
        ) {
          path.node.init = t.callExpression(
            t.memberExpression(
              t.memberExpression(t.identifier('window'), t.identifier('__viz')),
              t.identifier('createString')
            ),
            [init, t.stringLiteral(name)]
          );
          return;
        }

        // new Array(...)
        if (
          t.isNewExpression(init) &&
          t.isIdentifier(init.callee, { name: 'Array' })
        ) {
          path.node.init = t.callExpression(
            t.memberExpression(
              t.memberExpression(t.identifier('window'), t.identifier('__viz')),
              t.identifier('createArray')
            ),
            [init.arguments[0] || t.numericLiteral(0), t.stringLiteral(name)]
          );
          return;
        }

        // array literal
        if (t.isArrayExpression(init)) {
          path.node.init = t.callExpression(
            t.memberExpression(
              t.memberExpression(t.identifier('window'), t.identifier('__viz')),
              t.identifier('createArray')
            ),
            [t.arrayExpression(init.elements.map(e => e||t.nullLiteral())), t.stringLiteral(name)]
          );
          return;
        }

        // string literal
        if (t.isStringLiteral(init)) {
          path.node.init = t.callExpression(
            t.memberExpression(
              t.memberExpression(t.identifier('window'), t.identifier('__viz')),
              t.identifier('createString')
            ),
            [init, t.stringLiteral(name)]
          );
          return;
        }

        // primitive literal
        if (t.isNumericLiteral(init) || t.isBooleanLiteral(init)) {
          path.node.init = t.callExpression(
            t.memberExpression(
              t.memberExpression(t.identifier('window'), t.identifier('__viz')),
              t.identifier('createVar')
            ),
            [init, t.stringLiteral(name)]
          );
          return;
        }
      },

      AssignmentExpression(path) {
        const { left, right } = path.node;

        // arr[i] = val
        if (t.isMemberExpression(left) && t.isIdentifier(left.object)) {
          path.insertAfter(
            t.expressionStatement(
              t.callExpression(
                t.memberExpression(
                  t.memberExpression(t.identifier('window'), t.identifier('__viz')),
                  t.identifier('setArrayElement')
                ),
                [t.stringLiteral(left.object.name), left.property, right]
              )
            )
          );
        }

        // str = str + "x"
        if (t.isIdentifier(left) && t.isBinaryExpression(right, { operator: '+' })) {
          path.insertAfter(
            t.expressionStatement(
              t.callExpression(
                t.memberExpression(
                  t.memberExpression(t.identifier('window'), t.identifier('__viz')),
                  t.identifier('updateString')
                ),
                [t.stringLiteral(left.name), right]
              )
            )
          );
        }

        // str = str.concat("x")
        if (
          t.isIdentifier(left) &&
          t.isCallExpression(right) &&
          t.isMemberExpression(right.callee) &&
          t.isIdentifier(right.callee.property, { name: 'concat' })
        ) {
          path.insertAfter(
            t.expressionStatement(
              t.callExpression(
                t.memberExpression(
                  t.memberExpression(t.identifier('window'), t.identifier('__viz')),
                  t.identifier('updateString')
                ),
                [t.stringLiteral(left.name), right]
              )
            )
          );
        }

        // plain var reassignment (number/boolean/string)
        if (
          t.isIdentifier(left) &&
          !t.isMemberExpression(right) &&
          !(t.isBinaryExpression(right, { operator: '+' })) &&
          !(t.isCallExpression(right) &&
            t.isMemberExpression(right.callee) &&
            right.callee.property.name === 'concat') &&
          !(t.isCallExpression(right) && right.callee.name === 'readInput')
        ) {
          path.insertAfter(
            t.expressionStatement(
              t.callExpression(
                t.memberExpression(
                  t.memberExpression(t.identifier('window'), t.identifier('__viz')),
                  t.identifier('updateVar')
                ),
                [t.stringLiteral(left.name), right]
              )
            )
          );
        }
      },

      CallExpression(path) {
        if (isVizCall(path)) return;
        const callee = path.node.callee;

        // array mutators
        if (
          t.isMemberExpression(callee) &&
          t.isIdentifier(callee.object) &&
          t.isIdentifier(callee.property) &&
          mutatingMethods.includes(callee.property.name)
        ) {
          const arrName  = callee.object.name;
          const original = t.cloneNode(path.node, true);
          path.replaceWith(
            t.sequenceExpression([
              original,
              t.callExpression(
                t.memberExpression(
                  t.memberExpression(t.identifier('window'), t.identifier('__viz')),
                  t.identifier('refreshArray')
                ),
                [t.stringLiteral(arrName)]
              )
            ])
          );
          path.skip();
        }

        // **no more** refreshString here
      }
    }
  };
}







//App.js

import React, { useState, useEffect } from 'react';
import * as Babel from '@babel/standalone';
import arrayPlugin from './instrumentation';
import './App.css';

export default function App() {
  const [code, setCode] = useState(
`// Example:
let x = 5;
let flag = true;
let haystack = readInput();
let needle   = readInput();

let arr = [1,2,3];
arr.push(4);
arr[1] = 20;

let str = "hi";
str = str + "!";
str = str.concat(" there");
str = "bye";

x = 42;
flag = false;`
  );
  const [rawInput, setRawInput] = useState('hello world');
  const [vizDelay, setVizDelay] = useState(500);
  const [history, setHistory] = useState([]);
  const [step, setStep] = useState(0);

  const delay = ms => new Promise(res => setTimeout(res, ms));
  const clone = o => JSON.parse(JSON.stringify(o));

  const run = async () => {
    const snaps = [];
    const tokens = rawInput.trim().split(/\s+/).map(x => isNaN(x) ? x : Number(x));
    let inputBuffer = [...tokens];
    window.readInput = () => inputBuffer.shift();

    window.__vizArrays = {};
    window.__vizVars   = {};

    window.__viz = {
      createArray(data, name) {
        const arr = Array.isArray(data) ? [...data] : new Array(data).fill(null);
        window.__vizArrays[name] = arr;
        snaps.push(clone({ arrays: window.__vizArrays, vars: window.__vizVars }));
        return arr;
      },
      setArrayElement(name, idx, val) {
        window.__vizArrays[name][idx] = val;
        snaps.push(clone({ arrays: window.__vizArrays, vars: window.__vizVars }));
      },
      refreshArray(name) {
        snaps.push(clone({ arrays: window.__vizArrays, vars: window.__vizVars }));
      },
      createString(val, name) {
        const s = String(val);
        window.__vizVars[name]   = s;
        window.__vizArrays[name] = s.split('');
        snaps.push(clone({ arrays: window.__vizArrays, vars: window.__vizVars }));
        return s;
      },
      updateString(name, newVal) {
        window.__vizVars[name]   = newVal;
        window.__vizArrays[name] = String(newVal).split('');
        snaps.push(clone({ arrays: window.__vizArrays, vars: window.__vizVars }));
        return newVal;
      },
      refreshString(name) {
        snaps.push(clone({ arrays: window.__vizArrays, vars: window.__vizVars }));
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
      <h1>DSA Visualizer</h1>

      <label>
        Input (space-separated):
        <textarea
          rows={2}
          className="code-input"
          value={rawInput}
          onChange={e => setRawInput(e.target.value)}
        />
      </label>

      <textarea
        rows={10}
        className="code-input"
        value={code}
        onChange={e => setCode(e.target.value)}
      />

      <div className="control">
        <label>
          Visualization Delay (ms):
          <input
            type="number"
            value={vizDelay}
            onChange={e => setVizDelay(+e.target.value)}
          />
        </label>
        <button onClick={run}>Run</button>
      </div>

      <div className="arrays">
        {Object.entries(current.arrays).map(([name, arr]) => (
          <div key={name} className="array-block">
            <h3>Array “{name}”</h3>
            <div className="array-view">
              {arr.map((v, i) => (
                <div key={i} className="cell">
                  <div className="index">{i}</div>
                  <div className="value">{v !== null ? v : '∅'}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="vars">
        <h3>Variables</h3>
        <ul>
          {Object.entries(current.vars).map(([k, v]) => (
            <li key={k}>
              <code>{k}</code> = <code>{String(v)}</code>
            </li>
          ))}
        </ul>
      </div>

      {history.length > 0 && (
        <p className="status">
          Step {step + 1} of {history.length}
        </p>
      )}
    </div>
  );
}


//App.css




/* Reset & base typography */
body, h1, h3, ul, li, input, textarea, button {
  margin: 0;
  padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
.App {
  max-width: 900px;
  margin: 2rem auto;
  padding: 0 1rem;
}

/* Code inputs */
.code-input {
  width: 100%;
  font-family: 'Source Code Pro', monospace;
  font-size: 0.95rem;
  margin-top: 0.5rem;
  margin-bottom: 1rem;
  padding: 0.5rem;
  border: 1px solid #ccc;
  border-radius: 6px;
  box-shadow: inset 0 1px 3px rgba(0,0,0,0.1);
}

/* Controls */
.control {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1.5rem;
}
.control input {
  width: 5rem;
  padding: 0.25rem;
  border: 1px solid #ccc;
  border-radius: 4px;
}
.control button {
  padding: 0.5rem 1rem;
  background: 
#007bff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
.control button:hover {
  background: 
#0056b3;
}


.arrays {
  display: grid;
  /* / try to fit as many 200–300 px cards per row as possible /
  / grid-template-columns: repeat(auto-fill, minmax(200px, 300px)); / */
  /* justify-content: center;  / center the row of cards if there’s extra space */
  gap: 1.5rem;
}
.array-block {

  width: 100%;
}
.array-block:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(0,0,0,0.15);
}
.array-view {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.cell {
  background: 
#f9f9f9;
  border: 1px solid #ddd;
  border-radius: 6px;
  padding: 0.4rem;
  width: 40px;
  text-align: center;
}
.index {
  font-size: 0.6rem;
  color: #666;
}
.value {
  font-weight: bold;
  font-size: 1rem;
}

/* Variables panel */
.vars {
  margin-top: 2rem;
  background: white;
  padding: 1rem;
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.1);
}
.vars h3 {
  margin-bottom: 0.5rem;
}
.vars ul {
  list-style: none;
  max-height: 200px;
  overflow-y: auto;
}
.vars li {
  padding: 0.25rem 0;
  border-bottom: 1px solid #eee;
}
.vars li:last-child {
  border-bottom: none;
}

/* Status */
.status {
  text-align: center;
  margin: 1rem 0;
  color: #333;
}