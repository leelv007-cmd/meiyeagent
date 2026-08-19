import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const designPath =
  'docs/design/beauty-marketing-agent-product-design-2026-07-17.md';
const v31Path =
  'docs/design/0808规划/meiye-agent-v3.1-authoritative-plan-2026-08-08.md';
const specPaths = [
  'docs/specs/v3.1-agent-specs-2026-08-08/spec-A-429-foundation.md',
  'docs/specs/v3.1-agent-specs-2026-08-08/spec-B-430-session-plan.md',
  'docs/specs/v3.1-agent-specs-2026-08-08/spec-C-431-confirm-execute.md',
  'docs/specs/v3.1-agent-specs-2026-08-08/spec-D-433-delivery.md',
  'docs/specs/v3.1-agent-specs-2026-08-08/spec-E-432-memory-evidence.md',
  'docs/specs/v3.1-agent-specs-2026-08-08/spec-F-434-goal-proactive.md',
  'docs/specs/v3.1-agent-specs-2026-08-08/spec-G-435-release-eval.md',
  'docs/specs/v3.1-spec-H-ops-console-pending-publish.md',
  'docs/specs/v3.1-spec-I-legacy-retirement-pending-publish.md',
];
const authorityPaths = [designPath, v31Path, ...specPaths];

function decisionIndex(markdown) {
  return new Map(
    [
      ...markdown.matchAll(
        /^## (D-\d{3})(?:\s+|(?=[（(]))(.+)$/gm,
      ),
    ].map((match) => [
      match[1],
      match[2].trim(),
    ]),
  );
}

function governanceReferences(path, decisions) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .flatMap((line, index) => {
      if (!/(?:supersede|Supersedes|承接)/.test(line)) return [];
      return [...line.matchAll(/\b(D-\d{3})\b/g)].map((match) => ({
        id: match[1],
        line,
        lineNumber: index + 1,
        path,
        title: decisions.get(match[1]),
      }));
    });
}

test('every governance decision reference across current authority documents resolves to a title', () => {
  const design = readFileSync(designPath, 'utf8');
  const decisions = decisionIndex(design);
  const references = authorityPaths.flatMap((path) =>
    governanceReferences(path, decisions),
  );

  assert.ok(references.length > 0, 'authority scan must discover governance refs');
  for (const reference of references) {
    assert.ok(
      reference.title,
      `${reference.path}:${reference.lineNumber} ${reference.id} must resolve to a decision title`,
    );
  }
});

test('active V3.1 documents bind Recent to D-097 and never to video decision D-088', () => {
  const decisions = decisionIndex(readFileSync(designPath, 'utf8'));
  const activePaths = [v31Path, ...specPaths];
  for (const path of activePaths) {
    const lines = readFileSync(path, 'utf8').split('\n');
    for (const [index, line] of lines.entries()) {
      if (!/(?:\/dashboard\/recent|Recent|最近创作)/.test(line)) continue;
      if (!/(?:supersede|承接)/.test(line)) continue;
      const location = `${path}:${index + 1}`;
      assert.doesNotMatch(
        line,
        /(?:supersede|承接)\s+D-088/,
        `${location} must not govern Recent through D-088 (${decisions.get('D-088')})`,
      );
      assert.match(
        line,
        /(?:承接[^\n]*D-097|D-097[^\n]*承接)/,
        `${location} must carry Recent through D-097`,
      );
    }
  }
});

test('the D-178 erratum resolves Thread and Recent without superseding video regeneration', () => {
  const design = readFileSync(designPath, 'utf8');
  const decisions = decisionIndex(design);

  assert.equal(
    decisions.get('D-046'),
    '流内自由追问口：result 阶段常驻自由文本「调整方向」输入（聊天流三路复核裁决）',
  );
  assert.equal(
    decisions.get('D-088'),
    '视频局部重生与完整视频重生均为新的用户生成任务',
  );
  assert.equal(
    decisions.get('D-097'),
    '最近创作默认桌面六条移动四条，只通知关键可行动状态',
  );
  assert.match(design, /^### D-178 权威勘误（2026-08-19）$/m);
  assert.match(design, /Thread 禁令的正确 supersede 目标为 D-046/);
  assert.match(design, /Recent 投影另引用 D-097/);
  assert.match(design, /D-088 视频重生新任务与一次用户用量语义继续有效/);
  assert.match(
    design,
    /^### 2026-08-19 现行产品合同摘要（D-170～D-178）$/m,
  );
  assert.match(
    design,
    /D-155 现行处置以同日后置修订「归档移出主干」为准/,
  );
});

test('V3.1 exposes the correction, all 14 decisions, and all four reviews', () => {
  const v31 = readFileSync(v31Path, 'utf8');
  const top = v31.slice(0, v31.indexOf('## 0. 单一权威结论'));
  const section04 = v31.slice(
    v31.indexOf('### 0.4 决策登记'),
    v31.indexOf('### 0.5 明确不做'),
  );

  assert.match(top, /> \*\*权威勘误（2026-08-19）\*\*/);
  assert.match(top, /U1–U14/);
  assert.match(top, /v3\.1-specs-codex-xcheck-2026-08-08\.md/);
  assert.match(section04, /D-046/);
  assert.match(section04, /D-097/);
  assert.doesNotMatch(section04, /D-088「不新增 message\/thread 实体」/);
  assert.doesNotMatch(v31, /supersede D-016（部分）\/D-088/);
});

test('A–I spec headers make local truth explicit and remote issue data historical', () => {
  for (const specPath of specPaths) {
    const header = readFileSync(specPath, 'utf8')
      .split('\n')
      .slice(0, 8)
      .join('\n');
    assert.match(header, /\*\*票面真相\*\*：本地/);
    assert.match(header, /\*\*历史远程元数据\*\*/);
  }
});
