// instrumentation.js
export default function arrayPlugin({ types: t }) {
  const mutatingMethods = [
    'push','pop','shift','unshift',
    'splice','sort','reverse',
    'fill','copyWithin'
  ];

  function isVizCall(path) {
    if (!path.isCallExpression()) return false;
    const c = path.node.callee;
    return (
      t.isMemberExpression(c) &&
      t.isMemberExpression(c.object) &&
      t.isIdentifier(c.object.object, { name: 'window' }) &&
      t.isIdentifier(c.object.property, { name: '__viz' })
    );
  }

  return {
    visitor: {
      VariableDeclarator(path) {
        const init = path.node.init;
        const name = path.node.id.name;

        // wrap readInput()
        if (t.isCallExpression(init) && t.isIdentifier(init.callee, { name: 'readInput' })) {
          path.node.init = t.callExpression(
            t.memberExpression(
              t.memberExpression(t.identifier('window'), t.identifier('__viz')),
              t.identifier('createString')
            ),
            [init, t.stringLiteral(name)]
          );
          return;
        }

        // new Array(n)
        if (t.isNewExpression(init) && t.isIdentifier(init.callee, { name: 'Array' })) {
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
            [t.arrayExpression(init.elements.map(e => e || t.nullLiteral())), t.stringLiteral(name)]
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

        // 1) array element assignment
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

        // 2) string mutations: + or .concat()
        if (
          t.isIdentifier(left) &&
          (
            t.isBinaryExpression(right, { operator: '+' }) ||
            (
              t.isCallExpression(right) &&
              t.isMemberExpression(right.callee) &&
              right.callee.property.name === 'concat'
            )
          )
        ) {
          // keep original assignment, then snapshot new str value
          path.insertAfter(
            t.expressionStatement(
              t.callExpression(
                t.memberExpression(
                  t.memberExpression(t.identifier('window'), t.identifier('__viz')),
                  t.identifier('updateString')
                ),
                [t.stringLiteral(left.name), t.identifier(left.name)]
              )
            )
          );
          return;
        }

        // 3) plain var reassignment (number/boolean/string via direct assign)
        if (
          t.isIdentifier(left) &&
          !t.isMemberExpression(right) &&
          !(t.isBinaryExpression(right, { operator: '+' })) &&
          !(
            t.isCallExpression(right) &&
            t.isMemberExpression(right.callee) &&
            right.callee.property.name === 'concat'
          ) &&
          !(t.isCallExpression(right) && right.callee.name === 'readInput')
        ) {
          // original assignment stays, then snapshot new var value
          path.insertAfter(
            t.expressionStatement(
              t.callExpression(
                t.memberExpression(
                  t.memberExpression(t.identifier('window'), t.identifier('__viz')),
                  t.identifier('updateVar')
                ),
                [t.stringLiteral(left.name), t.identifier(left.name)]
              )
            )
          );
        }
      },

      CallExpression(path) {
        if (isVizCall(path)) return;
        const callee = path.node.callee;

        // array mutators: push/pop/etc.
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
      }
    }
  };
}
