/**
 * 评价事件的消费适配层（#261，设计稿 04 §3.3-§3.6 ＋ 裁定台账 08 C7/M4/O4/O5）。
 *
 * 事件合同的唯一属主是 #248（spec:580/:601）。本文件**不定义任何字段语义** ——
 * 它只做三件事：把前台已经拿在手里的值装进 #248 给的形状
 * （`packages/contracts/src/observability.ts`）、交给唯一出口、在没投出去时按
 * 上游的丢弃事件合同发一条可观测的 drop 事件。
 *
 * 本票兑现到哪为止（写在这里是为了不让验收时以「已埋点」充数，04 §3.5 A′）：
 * - payload 正确 —— 组装后必须过 `observabilityAxesSchema` 才投；
 * - 失败可观测 —— 每一次没投出去都留一条 `ObservabilityDropEvent`；
 * - 出口可一行替换 —— `setSubstrateEventDeliverer`，调用点与组装零改动。
 *
 * **不**兑现落库：`product-telemetry.ts:107` 的 `meiye:telemetry` 全仓零监听方，
 * `src/routes/api/` 下无 telemetry ingest 路由，gtag/plausible/umami 仅 PROD 加载
 * —— 落库端属 #248（04 §6.1 B2）。三轴的**值**属 #262 的 Task 快照（B4），main
 * 上取不到，所以生产路径当前一条都发不出去；这不是静默失败，每次拒发都有一条
 * drop 事件作为负向证据。
 */

import {
  type ContentPackageRevisionDelivery,
  type ObservabilityAxes,
  type ObservabilityDropEvent,
  observabilityAxesSchema,
} from '@meiye/contracts';

import {
  emitTelemetry,
  type TelemetryEventName,
} from '@/lib/product-telemetry';

/**
 * allowlist 里本票新增的那一条（`product-telemetry.ts:3-18`）。
 * 类型标注而非 `as`：allowlist 里没有的名字必须编译期就红（裁定 08 C7）。
 */
const RATING_EVENT_NAME: TelemetryEventName = 'rating_signal';

/** drop 事件的稳定来源标识，值须与 #248 的对账口径对齐（04 §7.3）。 */
const DROP_SOURCE = 'dashboard.rating-bar';

/**
 * 遥测通道对每个字符串字段做 `.slice(0, 120)`（`product-telemetry.ts:95`），而
 * `observabilityAxesSchema` 没有长度上限（04 §7.4）。两边不对齐时截断产出的是
 * 「看起来正常的错值」，比少一条更难查 —— 故本层不做预截断，超长直接拒发。
 */
const TELEMETRY_STRING_LIMIT = 120;

/**
 * verdict 值集合仍属 #248，且**上游尚未给**：`observability.ts` 全文只有 axes
 * 与 drop event，无任何 verdict 枚举（04 §7 ⚠️、§6.2 S2、03 §1.6）。这是本文件里
 * 唯一一个没能换成 import 的类型，**有意保留**为本票的诉求别名；#248 补齐枚举后
 * 换成 import，调用点一行不动。
 */
type RatingVerdict = 'up' | 'down' | 'up_cleared' | 'down_cleared';

export type DeliveryRatingEventInput = {
  verdict: RatingVerdict;
  /**
   * 产物标识直接取交付卡手里的那一份（`composer-delivery-card.tsx:28,42` 的
   * `revision` prop），不另取、不在这里重新声明形状。
   */
  delivery: ContentPackageRevisionDelivery;
  /**
   * 四轴（`skillRevision`/`promptVersion`/`catalogRevision`/`scene`，
   * `observability.ts:8-20`）。「场景」是第四个顶层键，不另开字段。
   * **允许为 undefined** —— 因为 main 上根本取不到（04 §3.4）。取不到时本层拒发
   * 并发一条 drop 事件，绝不补空串（D-160③「补录不可能」）。
   */
  axes: Partial<ObservabilityAxes> | undefined;
};

/**
 * 投递一条事件。抛异常＝投递失败，由 `emitDeliveryRatingEvent` 接住转 drop 事件。
 *
 * `eventName` 收窄为 `TelemetryEventName`（＝`keyof typeof fieldAllowlist`，
 * `product-telemetry.ts:20`），不是 `string` 也不用 `as` 绕：allowlist 是 A′ 通道
 * 唯一的字段守卫，用断言绕过等于把它的编译期保护关掉（裁定 08 C7）。
 */
export type SubstrateEventDeliverer = (
  eventName: TelemetryEventName,
  payload: Record<string, string | number | boolean>
) => void;

/** 丢弃事件出口。形状＝上游一等合同，不自造计数器（裁定 08 M4）。 */
export type ObservabilityDropSink = (event: ObservabilityDropEvent) => void;

const defaultDeliverer: SubstrateEventDeliverer = (eventName, payload) => {
  emitTelemetry(eventName, payload);
};

const defaultDropSink: ObservabilityDropSink = (event) => {
  // 与 product-telemetry.ts:107 同形的 CustomEvent：让 drop 在浏览器里真的可见，
  // 而不是变成又一个静默分支。不做「上报的上报」—— 发不出去就到此为止（04 §3.6）。
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('meiye:observability-drop', { detail: event })
  );
};

let deliverer: SubstrateEventDeliverer = defaultDeliverer;
let dropSink: ObservabilityDropSink = defaultDropSink;

/** #248 给出自己的 sender / ingest 端点后，一行切换，payload 组装零改动。 */
export function setSubstrateEventDeliverer(next: SubstrateEventDeliverer) {
  deliverer = next;
}

export function setObservabilityDropSink(next: ObservabilityDropSink) {
  dropSink = next;
}

/** 仅测试用：复位两个注入点。 */
export function resetDeliveryRatingEventWiring() {
  deliverer = defaultDeliverer;
  dropSink = defaultDropSink;
}

function drop(reason: ObservabilityDropEvent['reason']) {
  const event: ObservabilityDropEvent = {
    count: 1,
    reason,
    signal: 'feedback',
    source: DROP_SOURCE,
  };
  try {
    dropSink(event);
  } catch {
    // sink 是可注入的外部实现；它自己坏掉不该让商家的评价按钮报错。
  }
  return false;
}

/**
 * 组装并投递。**永不抛** —— 评价按钮不该因为埋点失败而报错给商家。
 * 返回是否真的投出去了，供测试与调用点判断。
 *
 * 没投出去时发一条 drop 事件（每次一条，`count` 恒为 1）。`reason` 取上游闭集
 * （`observability.ts:35`）：
 * - `permanent-config` —— 轴缺失或格式不合（上游未接，重试也不会有）、
 *   任一字符串超通道上限（长度合同不对齐）；
 * - `transient` —— deliverer 抛异常（网络抖动/超时/被拦截器打断）。
 *
 * 注：设计稿把「drop sink 本身不存在」也算进 `permanent-config`；本实现的 sink
 * 始终有默认值，那条分支不存在。
 */
export function emitDeliveryRatingEvent(
  input: DeliveryRatingEventInput
): boolean {
  // 先过一次上游 schema：`compositeRevisionSchema` 的正则比想象严（恰好一个 `@`、
  // 两侧非空且无空白），组装完不校验就投等于把废数据当成功。parse 会顺带 trim，
  // 故投的是 schema 认下来的那份值，不是入参原值。
  const axes = observabilityAxesSchema.safeParse(input.axes);
  if (!axes.success) return drop('permanent-config');

  const payload = {
    catalogRevision: axes.data.catalogRevision,
    packageId: input.delivery.packageId,
    promptVersion: axes.data.promptVersion,
    revision: input.delivery.revision,
    scene: axes.data.scene,
    skillRevision: axes.data.skillRevision,
    verdict: input.verdict,
    versionId: input.delivery.versionId,
  };

  // 长度门覆盖 payload 里**全部**字符串，不止四轴：截断是通道的性质
  // （`buildTelemetryEvent` 对每个字符串一视同仁），超长的 packageId 会被同样
  // 静默改写成错值。设计稿只点名了轴，这里按同一条理由放宽。
  const overLimit = Object.values(payload).some(
    (value) =>
      typeof value === 'string' && value.length > TELEMETRY_STRING_LIMIT
  );
  if (overLimit) return drop('permanent-config');

  try {
    deliverer(RATING_EVENT_NAME, payload);
    return true;
  } catch {
    return drop('transient');
  }
}
