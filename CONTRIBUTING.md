# Contributing

A frontend for abap2UI5 built on UI5 Web Components - no UI5 core, one
embeddable custom element.

## Before you open a pull request

Read [AGENTS.md](AGENTS.md) first - it holds the module layout, the vendored
files, the control-mapper rules and the checks. Then run what CI runs:

```sh
npm ci
npm run lint
npm test
npm run vendor:check
npm run build
```

The end-to-end tests need the demo backend and a browser:

```sh
npm run demo:build
npx playwright install --with-deps chromium
npm run e2e
```

## What the gates are

| Gate | What it proves |
| --- | --- |
| `npm run lint` | ESLint over the sources |
| `npm test` | the unit tests; they also fail when the control coverage table of the README is stale |
| `npm run vendor:check` | the vendored agent modules are unchanged copies of their source |
| `npm run build` | the bundle builds, and its size is reported |
| `npm run e2e` | Playwright: the demo apps render and react in a browser |

Vendored files are never edited here - re-vendor them with the scripts the
README's Development section lists.

## Conventions

English for code, comments, commit messages and pull requests. Commit subjects
are written in the imperative and describe the outcome, not the mechanics. One
topic per pull request. The wider rules the whole ecosystem follows live in
[abap2UI5's CONVENTIONS.md](https://github.com/abap2UI5/abap2UI5/blob/main/.github/shared/CONVENTIONS.md).
