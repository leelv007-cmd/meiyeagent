# Third-party notices

No third-party source is copied into this app today.

The prompt-kit `ResponseStream` adaptation that used to live at
`src/components/markdown/response-stream.tsx` was retired in U03: the HeroUI Pro
V3 `markdown` unit already wraps Streamdown, so keeping the local copy meant two
answers to one question. The 「无假流式」boundary it existed to hold — never
replay a completed response as fake streaming — moved with it and is asserted in
`src/components/markdown/ai-markdown.interaction.test.tsx`.

The HeroUI Pro V3 supply layer under `src/components/heroui-pro/vendor/` is
generated from a licensed mirror rather than copied by hand; see
`src/components/heroui-pro/README.md` for its terms (never committed, never
redistributed) and `vendor-patches.json` for every local rewrite.
