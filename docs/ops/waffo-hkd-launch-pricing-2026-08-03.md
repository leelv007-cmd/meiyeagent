# Waffo HKD Test fixture pricing

This record fixes the Test-only subscription fixture prices for #304. It is not
a production launch price or a runtime currency conversion mechanism.

## Source and rule

- Source: ECB daily euro reference rates, [2026-07-31](https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml).
- Source values: `CNY/EUR = 7.7539`; `HKD/EUR = 9.0079`.
- Cross-rate: `1 CNY = 1.1617250674 HKD`.
- Rule: multiply each former CNY fixture amount by the cross-rate and round to
  the nearest whole HKD. The resulting value is stored as cents with `.00`.

## Fixed subscription catalog

| Tier | single_month | monthly | yearly |
| --- | ---: | ---: | ---: |
| Starter | HKD 231.00 | HKD 208.00 | HKD 2,081.00 |
| Growth | HKD 580.00 | HKD 522.00 | HKD 5,217.00 |
| Pro | HKD 1,044.00 | HKD 940.00 | HKD 9,400.00 |

The prior nine CNY Test products and three groups remain legacy and unmapped.
They are neither changed, deleted, nor published. The HKD groups use distinct
names, and provisioning requires the already registered Test webhook ID rather
than creating another webhook.
