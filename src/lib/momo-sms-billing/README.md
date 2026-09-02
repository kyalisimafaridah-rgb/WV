# Vendored: momo-sms-billing v1.0.0

`parser.cjs`, `matcher.cjs`, `types.cjs` are copied from
`momo-sms-billing`'s compiled `dist/` output (the parts with zero
dependencies — no Express, so no new package.json entries needed),
renamed from `.js` to `.cjs`. That rename is required, not cosmetic:
this project's package.json has `"type": "module"`, so a plain `.js`
file here would be parsed as ESM and every `exports.x = ...` line
would fail. `.cjs` forces Node to treat them as CommonJS regardless
of the parent package.json.

Do not hand-edit these files. If the SMS wording changes or a bug is
found in parsing/matching, fix it in the original momo-sms-billing
project, re-copy `dist/parser.js` → `parser.cjs`, `dist/matcher.js` →
`matcher.cjs`, `dist/types.js` → `types.cjs`, and re-apply the
`require("./parser")` → `require("./parser.cjs")` path fix inside
matcher.cjs (see git history / the sed command used originally).

Import these with a default import, not named imports —
`import matcher from './matcher.cjs'; const { processInboundMomoSms } = matcher;`
— named imports failed static detection during setup even though the
exports are plain assignments; default import is the reliable form.

Everything WiFi-Voucher-specific (the Supabase StorageAdapter, the
webhook route, the owner-facing billing endpoint) lives in
`src/services/momo-storage-adapter.js` and `src/routes/momo-webhook.js`
— not in this folder.
