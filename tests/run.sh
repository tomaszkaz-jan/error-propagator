#!/bin/sh
# Runs the tests with macOS's built-in JavaScript engine (no install needed).
DIR="$(cd "$(dirname "$0")/.." && pwd)"
osascript -l JavaScript - "$DIR" <<'EOF'
ObjC.import('Foundation');
function run(argv) {
  const dir = argv[0];
  const read = (p) => $.NSString.stringWithContentsOfFileEncodingError(dir + '/' + p, $.NSUTF8StringEncoding, null).js;
  eval(read('vendor/math.js'));
  eval(read('src/propagate.js'));
  eval(read('tests/tests.js'));
  const results = runTests();
  const failed = results.filter((r) => !r.ok);
  const lines = results.map((r) => (r.ok ? 'PASS  ' : 'FAIL  ') + r.name + (r.ok ? '' : '\n      ' + r.msg));
  lines.push('', (results.length - failed.length) + '/' + results.length + ' passed');
  return lines.join('\n');
}
EOF
