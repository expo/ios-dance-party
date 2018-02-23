const assert = require('assert');
const childProcess = require('child_process');
const JUnitReportBuilder = require('junit-report-builder');
const stream = require('stream');

const TEST_SUITE_END_SENTINEL = '[TEST-SUITE-END]';

class IosLogStream extends stream.Transform {
  constructor(options) {
    super(options);
    this.entries = [];
    this.onEnd = options.onEnd;
  }

  _transform(data, encoding, callback) {
    callback(null, data);

    // In practice, we receive each log entry as a separate chunk and can test if they are valid,
    // JSON-formatted log entries
    let entry;
    try {
      entry = JSON.parse(data);
    } catch (e) {}

    if (entry) {
      this.entries.push(entry);
      let isLastMessage =
        entry.eventMessage &&
        entry.eventMessage.startsWith(TEST_SUITE_END_SENTINEL);
      if (isLastMessage && this.onEnd) {
        this.onEnd(this.entries);
      }
    }
  }
}

/**
 * Converts the given results from the iOS app into a JUnit-formatted report and writes it to the
 * given location.
 */
function writeJUnitReport(results, filePath) {
  let builder = JUnitReportBuilder.newBuilder();
  let suite = builder.testSuite().name('Test Suite');

  // TODO: parse the results

  builder.writeTo(filePath);
}

let simulatorLogProcess = childProcess.spawn(
  'xcrun',
  [
    'simctl',
    'spawn',
    'booted',
    'log',
    'stream',
    '--style',
    'json',
    '--predicate',
    '(subsystem == "host.exp.Exponent") && (category == "test")',
  ],
  {
    stdio: ['ignore', 'pipe', 'inherit'],
  }
);

let logStream = new IosLogStream({
  onEnd(entries) {
    try {
      simulatorLogProcess.kill('SIGTERM');

      assert(entries.length === 1, `There should be exactly one log entry`);
      let [entry] = entries;

      assert(
        entry.eventMessage,
        `The iOS log entry should have an "eventMessage" field`
      );
      let message = entry.eventMessage;
      assert(
        entry.eventMessage.startsWith(TEST_SUITE_END_SENTINEL),
        `The log entry with results should start with ${TEST_SUITE_END_SENTINEL}`
      );
      let resultsJson = message.substring(TEST_SUITE_END_SENTINEL.length).trim();
      let results = JSON.parse(resultsJson);

      if (results.failed === 0) {
        console.log(`😊 All tests passed`);
      } else {
        console.log(`😣 ${results.failed} ${results.failed === 1 ? 'test' : 'tests'} failed`)
      }

      let reportPath = '/tmp/test-results/test-suite.xml';
      writeJUnitReport(results, reportPath);
      console.log(`Saved test results to ${reportPath}`);

      process.exit(0);
    } catch (e) {
      console.error(e.stack);
      process.exit(1);
    }
  },
});

simulatorLogProcess.stdio[1].pipe(logStream);
logStream.pipe(process.stdout);

childProcess.spawnSync('xcrun', ['simctl', 'launch', 'booted', 'io.expo.testsuite'], { stdio: 'inherit' });
