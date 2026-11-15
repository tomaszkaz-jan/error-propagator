# Error Propagator

A web app for lab reports. Type an equation, enter each measured variable with its uncertainty, and get the result ± uncertainty, rounded properly. It also shows which variable contributes most to the uncertainty and the full working.

## Use it
Double-click `index.html` to open it in a browser. It works offline because math.js is stored in `vendor/`.

## Methods
- **Partial derivatives** (standard): σ_f² = Σ (∂f/∂xᵢ · σᵢ)², with derivatives worked out exactly by math.js
- **Simple rules**, step by step: add absolute uncertainties for + and −, add % uncertainties for × and ÷, multiply the % by n for powers
- **Max–min**: evaluate at every combination of xᵢ ± Δxᵢ and take half the range
- **Monte Carlo check**: simulates 100,000 measurements and warns when the formula's straight-line approximation isn't reliable

All maths is rendered in LaTeX (KaTeX), and the result and the full working can be copied as LaTeX.

## Table of readings
Switch to **Table of readings** to run the same equation on many rows. Each variable's uncertainty can be the same for every row or different for each row. You can paste cells straight from Excel or Google Sheets, and Enter moves down a row. Each row gets its own result and Monte Carlo check. A summary gives the mean ± standard error, the standard deviation and the weighted mean, and warns when the results scatter more than their uncertainties suggest (reduced χ²). Click a row number to see that row's working. Use **Export CSV** to save the table, or **Copy as LaTeX table** for your report.

## Files
- `src/propagate.js`: the maths engine (parsing, derivatives, rounding)
- `src/app.js`, `src/style.css`, `index.html`: the interface
- `tests/tests.js`: test cases with independently worked answers
- `vendor/math.js`: math.js 12.4.2
- `vendor/katex/`: KaTeX 0.16.11 (renders LaTeX)

## Tests
    ./tests/run.sh
Or open `tests.html` in a browser.

## Roadmap
- **v1** (done): single calculation, partial-derivative method, contribution breakdown, working
- **v2** (done): simple-rules and max–min methods, Monte Carlo cross-check, LaTeX everywhere and LaTeX copy
- **v3** (done): table mode built into the app, paste from Excel, per-row Monte Carlo, summary statistics, CSV export, LaTeX table
- **Next**: named saved sessions (e.g. one per lab)
- **Later**: units checking, hosting on GitHub Pages
