# Ticket 04 closure evidence

The 73.52-second continuous browser recording shows the same honest Douyin
contract in three real dev surfaces:

- Administrator: `未接入（硬编码 recorded 装配）`, with an explicit warning
  that recorded evidence must not be described as "only missing a key".
- Merchant desktop settings: `抖音官方连接未接入`, and L3 manual publishing
  remains the stated path.
- Merchant mobile settings at a 390x844 viewport: the same unavailable status
  and wording, without a false connected or live-publish action.

The backend status query returned `integrated=false` and
`executionMode=recorded`; see `status-evidence.json`. Existing mobile action
book regression coverage remains referenced by the frozen
`docs/evidence/uiux-cutover/s4-mobile-publishing-settings-governance.md`
fixture report, while this bundle supplies the missing real dev UI evidence.
