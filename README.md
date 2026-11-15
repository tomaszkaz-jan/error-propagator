# Error Propagator

A web app for lab reports. Type an equation, enter each measured variable with its uncertainty, and get the result ± uncertainty, rounded properly. It also shows which variable contributes most to the uncertainty and the full working.

## Use it
Double-click `index.html` to open it in a browser. It works offline because math.js is stored in `vendor/`.

## How it works
It uses the general propagation formula for independent variables:

    σ_f² = Σ (∂f/∂xᵢ · σᵢ)²

math.js works out the partial derivatives exactly (symbolically), and the app then evaluates them at your measured values.

## Files
- `src/propagate.js`: the maths engine (parsing, derivatives, rounding)
- `src/app.js`, `src/style.css`, `index.html`: the interface
- `tests/tests.js`: test cases with independently worked answers
- `vendor/math.js`: math.js 12.4.2

## Tests
    ./tests/run.sh
Or open `tests.html` in a browser.

## Roadmap
- **v1** (done): single calculation, partial-derivative method, contribution breakdown, working
- **v2**: simple-rules and max–min methods, Monte Carlo cross-check, LaTeX copy
- **v3**: table mode (paste readings from Excel), CSV export, saved sessions
- **Later**: units checking, hosting on GitHub Pages
