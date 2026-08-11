import assert from 'node:assert/strict';
import test from 'node:test';
import { createPromptfooRun } from './run-promptfoo.mjs';

for (const suite of [
  'copywriting',
  'fact-satisfaction',
  'merchant-language',
  'redlines',
]) {
  test(`${suite} supports production and control arguments`, () => {
    const production = createPromptfooRun(suite, [], '/missing');
    assert.ok(production.args.includes(`promptfooconfig.${suite}.yaml`));
    assert.equal(
      production.output,
      `output/evals/promptfoo-${suite}.json`,
    );

    const control = createPromptfooRun(
      suite,
      ['--control', 'custom.json'],
      '/missing',
    );
    assert.ok(
      control.args.includes(
        `promptfooconfig.${suite}.assertion-control.yaml`,
      ),
    );
    assert.equal(control.output, 'custom.json');
  });
}

test('rejects an unknown Promptfoo suite before spawning', () => {
  assert.throws(
    () => createPromptfooRun('unknown', [], '/missing'),
    /Unknown Promptfoo suite/u,
  );
});
