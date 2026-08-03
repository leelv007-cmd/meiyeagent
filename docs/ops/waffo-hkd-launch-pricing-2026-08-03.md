# Governed HKD billing pricing

This record fixes the governed merchant subscription and credit-package prices.
It is not a runtime currency conversion mechanism. Waffo resources used by
#304/#308 remain Test-only and unpublished; this record does not authorize any
Production product, route, traffic, or data change.

## Source and rule

- Source: ECB daily euro reference rates, [2026-07-31](https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml).
- Source values: `CNY/EUR = 7.7539`; `HKD/EUR = 9.0079`.
- Cross-rate: `1 CNY = 1.1617250674 HKD`.
- Rule: persist the converted plan basis once as HKD micros and apply the
  governed `1.00 / 0.90 / (0.75 x 12)` coefficients. Only the final public or
  checkout amount is rounded to the nearest whole HKD. No runtime FX lookup or
  second per-period price source is used.

## Fixed subscription catalog

| Tier | single_month | monthly | yearly |
| --- | ---: | ---: | ---: |
| Starter | HKD 231.00 | HKD 208.00 | HKD 2,081.00 |
| Growth | HKD 580.00 | HKD 522.00 | HKD 5,217.00 |
| Pro | HKD 1,044.00 | HKD 940.00 | HKD 9,400.00 |

The single governed `monthlyPriceMicros` values are `231183288`, `579700809`,
and `1044390836` for Starter, Growth, and Pro respectively.

## Fixed credit-package catalog

| Credits | Price | Expiry |
| ---: | ---: | ---: |
| 100 | HKD 57.00 | 7 days |
| 300 | HKD 161.00 | 7 days |
| 1,000 | HKD 498.00 | 7 days |

The prior CNY Test subscription products, product groups, and any explicitly
legacy CNY one-time products remain legacy and unmapped. They are neither
changed, deleted, nor published. A stored CNY `plan.credits.*` revision fails
closed until an operator explicitly publishes the HKD values through the
existing CAS admin-config flow; startup never rewrites it silently.
