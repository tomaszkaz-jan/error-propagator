# Error Propagator

A web app for lab reports. Type an equation, enter each measured variable with its uncertainty, and get the result ± uncertainty, rounded properly. It also shows which variable contributes most to the uncertainty and the full working.

## Use it
**Online:** https://tomaszkaz-jan.github.io/error-propagator/ (works on phones too)

**Offline:** double-click `index.html` to open it in a browser. Everything it needs, including math.js and KaTeX, is in `vendor/`.

Saved sessions are kept separately by the online and offline versions. Use **Back up** and **Restore** to move them between the two.

## Methods
- **Partial derivatives** (standard): σ_f² = Σ (∂f/∂xᵢ · σᵢ)², with derivatives worked out exactly by math.js
- **Simple rules**, step by step: add absolute uncertainties for + and −, add % uncertainties for × and ÷, multiply the % by n for powers
- **Max–min**: evaluate at every combination of xᵢ ± Δxᵢ and take half the range
- **Monte Carlo check**: simulates 100,000 measurements and warns when the formula's straight-line approximation isn't reliable

All maths is rendered in LaTeX (KaTeX), and the result and the full working can be copied as LaTeX.

## Units
Units are optional. Type them in each variable's unit box (e.g. `cm`, `s`, `kg`, `m/s^2`, `degC`, `deg`). Values and uncertainties are converted to SI, the maths is done in SI, and math.js checks that the equation's units make sense: adding a length to a time, or taking `sin` of a length, gives a clear error. The result's unit is worked out automatically, or you can choose one (e.g. `cm/s^2`, `km/h`, `N`). Uncertainties convert by scale only, so ±0.5 °C is ±0.5 K. Angles given in `deg` or `rad` are handled correctly whichever Angles setting is chosen.

## Straight-line fit and graph
In table mode, the **Straight-line fit** section plots any two columns against each other. Each axis can be the result, a variable, or an expression such as `T^2` or `1/d^2`, and every axis gets propagated uncertainties. The fit is a weighted least-squares line y = mx + c, using the same formulas as the Year 1 lab's `LSFR-25.py`. Tests check that it reproduces that script's output on real lab data to 9 significant figures.

It gives:
- m ± σ_m and c ± σ_c, with units
- χ², degrees of freedom, reduced χ², and the probability P(χ² ≥ observed)
- a plain-English verdict on the fit
- a residuals plot

Two optional extras that LSFR doesn't have: include x error bars in the fit (effective variance), and fit a line through the origin.

You can export the graph as a high-resolution PNG (laid out like LSFR's figure), copy it as LaTeX (pgfplots), or copy the fit results as LaTeX. The fit is also included in the CSV.

## Accepted values, repeats, constants
- **Accepted value:** type one in the settings and the result is compared with it: the difference, the percentage difference, and how many σ apart they are, with the working in LaTeX. In table mode the mean is compared too.
- **Repeated readings:** press **Repeats** beside a variable and enter several readings. The mean becomes the value and the standard error s/√n, combined in quadrature with the instrument uncertainty, becomes the uncertainty.
- **Constants:** name a variable `g`, `c`, `h`, `hbar`, `k_B`, `N_A`, `R`, `G`, `q_e`, `epsilon_0`, `mu_0`, `m_e` or `m_p` and a button offers to fill in its CODATA 2018 value, uncertainty and unit.
- **Same value in every row:** in table mode, tick this for a variable that doesn't change, and it leaves the grid.
- **Calculate from the fit:** under the graph, use the slope `m` and intercept `c` in an equation such as `g = 4*pi^2/m`. The correlation between `m` and `c` is included.

## Saved sessions
Each lab can be its own session: **+ New**, **Rename**, **Duplicate** and **Delete** (two clicks). Everything saves automatically in this browser. Sessions live in the browser you use (and depend on how you open the app), so use **Back up** to download them all as a file and **Restore** to load them elsewhere.

## Table of readings
Switch to **Table of readings** to run the same equation on many rows. Each variable's uncertainty can be the same for every row or different for each row. You can paste cells straight from Excel or Google Sheets, and Enter moves down a row. Each row gets its own result and Monte Carlo check. A summary gives the mean ± standard error, the standard deviation and the weighted mean, and warns when the results scatter more than their uncertainties suggest (reduced χ²). Click a row number to see that row's working. Use **Export CSV** to save the table, or **Copy as LaTeX table** for your report.

## Files
- `src/propagate.js`: the maths engine (parsing, derivatives, rounding, units, linear fit)
- `src/plot.js`: draws the fit graph and residuals (SVG and PNG)
- `src/app.js`, `src/style.css`, `index.html`: the interface
- `tests/tests.js`: test cases with independently worked answers
- `vendor/math.js`: math.js 12.4.2
- `vendor/katex/`: KaTeX 0.16.11 (renders LaTeX)
- `vendor/fonts/`: Geist and Geist Mono (SIL Open Font License, see `OFL-LICENSE.txt`)

## Tests
    ./tests/run.sh
Or open `tests.html` in a browser.

## Roadmap
- **v1** (done): single calculation, partial-derivative method, contribution breakdown, working
- **v2** (done): simple-rules and max–min methods, Monte Carlo cross-check, LaTeX everywhere and LaTeX copy
- **v3** (done): table mode built into the app, paste from Excel, per-row Monte Carlo, summary statistics, CSV export, LaTeX table
- **v4** (done): saved sessions with backup/restore, units with dimension checking and unit conversion
- **Hosted** on GitHub Pages
- **v5**: straight-line fit and graph (LSFR method) in table mode
- **v8**: layout: settings collapse to one line so the result sits under the inputs, table results in tabs (Summary, Graph and fit, Row working), symbol keys on touch screens, arrow keys and header-row detection in the table, Undo for clearing readings and deleting rows or sessions, print layout
- **v7**: accepted-value comparison, calculate from the fit, repeated readings, constants, fixed table columns; fixes for phone keyboards, the Example button and graph defaults
- **v6**: design polish: Geist type, one consistent design system, light/dark/system theme, session actions in a menu, labelled inputs, example equations, keyboard focus and touch-size controls, WCAG AA contrast
- **Later**: units checking, hosting on GitHub Pages
