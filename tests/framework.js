/**
 * 轻量级前端测试框架（浏览器环境，零依赖）
 * 用法：
 *   TestRunner.suite('模块名', (t) => {
 *     t.test('测试名', async () => { ... });
 *   });
 *   const results = await TestRunner.run();
 */
'use strict';

const TestRunner = {
  _suites: [],

  /** 注册测试套件 */
  suite(name, fn) {
    const suite = { name, tests: [] };
    const t = {
      test(testName, testFn) {
        suite.tests.push({ name: testName, fn: testFn });
      }
    };
    fn(t);
    this._suites.push(suite);
  },

  /** 运行所有测试 */
  async run() {
    const results = [];
    for (const suite of this._suites) {
      const suiteResult = { name: suite.name, tests: [] };
      for (const test of suite.tests) {
        const start = performance.now();
        try {
          await test.fn();
          suiteResult.tests.push({
            name: test.name,
            pass: true,
            duration: performance.now() - start
          });
        } catch (e) {
          suiteResult.tests.push({
            name: test.name,
            pass: false,
            error: e.message || String(e),
            stack: e.stack,
            duration: performance.now() - start
          });
        }
      }
      results.push(suiteResult);
    }
    return results;
  },

  /** 渲染结果为 HTML */
  renderHTML(results) {
    let totalPass = 0, totalFail = 0;
    let html = '';

    for (const suite of results) {
      html += `<div class="suite"><div class="suite-name">${suite.name}</div>`;
      for (const test of suite.tests) {
        if (test.pass) {
          totalPass++;
          html += `<div class="test pass">✓ ${test.name} (${test.duration.toFixed(1)}ms)</div>`;
        } else {
          totalFail++;
          html += `<div class="test fail">✗ ${test.name} (${test.duration.toFixed(1)}ms)</div>`;
          html += `<div class="error-detail">${test.error}</div>`;
        }
      }
      html += '</div>';
    }

    const cls = totalFail === 0 ? 'all-pass' : 'has-fail';
    html += `<div class="summary ${cls}">${totalPass} passed, ${totalFail} failed</div>`;
    return html;
  },

  // --- 断言工具 ---
  assert: {
    equal(actual, expected, msg) {
      if (actual !== expected) {
        throw new Error(`${msg || 'assertEqual'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
    deepEqual(actual, expected, msg) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`${msg || 'assertDeepEqual'}: values differ\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
      }
    },
    ok(value, msg) {
      if (!value) throw new Error(msg || 'assertOk: value is falsy');
    },
    throws(fn, msg) {
      let threw = false;
      try { fn(); } catch (e) { threw = true; }
      if (!threw) throw new Error(msg || 'assertThrows: expected an error');
    },
    async rejects(fn, msg) {
      let threw = false;
      try { await fn(); } catch (e) { threw = true; }
      if (!threw) throw new Error(msg || 'assertRejects: expected a rejection');
    }
  }
};
