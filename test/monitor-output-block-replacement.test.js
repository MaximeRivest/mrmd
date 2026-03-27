import test from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeMonitor } from '../src/monitor/monitor.js';

test('replacing an existing output block preserves the following blank line', () => {
  const monitor = new RuntimeMonitor('ws://unused', '/tmp/test.md', {
    log: () => {},
    enableTableJobs: false,
  });

  monitor.coordination = {
    setOutputBlockReady() {},
    setError() {},
  };

  const originalContent = [
    '# Test',
    '',
    '```bash',
    'echo hello',
    '```',
    '',
    '```output:old-exec',
    'hello',
    '```',
    '',
    'After output',
    '',
  ].join('\n');

  monitor.ydoc.getText('content').insert(0, originalContent);

  monitor._createOutputBlockAndReady('new-exec', {
    code: 'echo hello',
    language: 'bash',
  });

  const updatedContent = monitor.ydoc.getText('content').toString();

  assert.equal(
    updatedContent,
    [
      '# Test',
      '',
      '```bash',
      'echo hello',
      '```',
      '',
      '```output:new-exec',
      '```',
      '',
      'After output',
      '',
    ].join('\n'),
  );
  assert.ok(!updatedContent.includes('```output:old-exec'));
});
