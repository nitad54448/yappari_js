# Yappari JS

Browser version of [Yappari 5.1](https://nitad54448.github.io/yappari-5-1/) (LabVIEW): one equivalent circuit
fitted to one or to thousands of impedance spectra.

Open `index.html` in Chrome, Edge or Firefox. A double-click is enough: no server, no installation, nothing is
uploaded. The same folder can be published on GitHub Pages. Settings, the last circuit and the element start values
are remembered by the browser (localStorage).

**Status.** Step 1: reading data, circuit editor, simulation, plots, fits (one by one, in parallel, global),
masking, data operations, saving, report. Step 2: DRT (Tikhonov, Fisk, Gold, λ search), Z-HIT,
frequency labels on Nyquist plots, contributions of the parts in series, measured-error weights, undo, dark mode.

## Files

```
index.html            page layout
style.css             all styles (light and dark)
js/core/namespace.js  global object Y; Y.defineCore keeps the source of DOM-free modules for the workers
js/core/elements.js   element library: parameters, start values, limits, Z(ω)
js/core/circuit.js    circuit code parser and printer, tree editing, compiler, vectorised evaluator
js/core/linalg.js     Cholesky solve and inverse
js/core/fit.js        weights, residuals, TRDL, LM (bounded / unbounded), Nelder–Mead, statistics
js/core/globalfit.js  global fit with shared and local parameters (block Levenberg–Marquardt)
js/core/dataops.js    noise, Zi sign, correction factor, log spline, Savitzky–Golay, average, view selection
js/io/readers.js      3 columns, tables with headers, ZView, VersaStudio, custom definitions
js/io/writers.js      data, parameters, project files, downloads
js/state.js           datasets, selection, circuit, parameters, settings, event bus
js/workers.js         Web Worker pool built from a Blob (works from file://), main-thread fallback
js/ui/*.js            plots (canvas 2D and 3D), schematic, Model tab, panels, dialogs, menus, report
js/app.js             start-up
files/                example data files and custom-format definitions (Yappari 5.1 XML)
script/               third-party libraries, none needed for now
tests/                node tests/run_core_tests.js (core, readers, the files/ examples);
                      tests/browser_test.py drives index.html in headless Chromium (Playwright)
```

## Circuit code

Boukamp's circuit description code. Elements written next to each other are in series, `( )` puts its content in
parallel, `[ ]` puts its content in series inside a parallel group:

```
R(RQ)(Q[RW])   =   R1 + (R2 ‖ Q1) + (Q2 ‖ (R3 + W1))
```

Elements: `R C L Q W Wo Ws G HN`. Numbers name the elements (`R1`, `Q2`); missing numbers are added, so the
code shown is always numbered: `R1(R2Q1)(Q2[R3W1])`. Spaces, commas and dashes are ignored. Any depth of nesting
is allowed. Editing the circuit keeps the values of the parameters whose element still exists, and an element
that comes back (Undo) gets its old values back.

In the Model tab, click an element or a group in the drawing, choose *In series*, *In parallel* or *Replace*,
then click an element of the palette or pick a template. Delete, Ctrl+Z and Esc work on the drawing.

## Elements and parameter names

| Code | Element | Z | Parameters (element 1) |
|---|---|---|---|
| R | resistor | R | `R1` |
| C | capacitor | 1/(jωC) | `C1` |
| L | inductor | jωL | `L1` |
| Q | constant phase element | 1/(Q (jω)^n) | `Q1`, `Q1_n` |
| W | Warburg, semi-infinite | Aw/√ω − j·Aw/√ω | `W1` (Aw) |
| Wo | Warburg open, reflective | Aw/√(jω) · coth(B√(jω)) | `Wo1_A`, `Wo1_B` |
| Ws | Warburg short, transmissive | Aw/√(jω) · tanh(B√(jω)) | `Ws1_A`, `Ws1_B` |
| G | Gerischer | R/√(1 + jωτ) | `G1_R`, `G1_tau` |
| HN | Havriliak–Negami | R/(1 + (jωτ)^α)^β | `HN1_R`, `HN1_tau`, `HN1_a`, `HN1_b` |

W, Wo and Ws follow Yappari's help/theory.md. For large B, Wo and Ws tend to W with an Aw larger by √2.
The composite elements of the LabVIEW version (Randles variants, M00x) are templates in the Model tab.

## Fitting

* χ²w = Σ w·[(Zr − Zr calc)² + (Zi − Zi calc)²], with w = 1/|Z|, 1/|Z|² or 1 (measured |Z|).
* Reduced χ² = χ²w / (2N − p): N frequencies, real and imaginary parts both counted, p fitted parameters.
* R² = 1 − SS_res/SS_tot on the stacked, unweighted (Zr, Zi) values.
* Standard errors, in % of the value: square root of the diagonal of s²(JᵀJ)⁻¹ with s² = reduced χ², J from
  central differences at the solution. Given for every method; a parameter that ends on a limit gets none.
  On simulated spectra with noise matching the weights, these errors agree with the scatter of repeated fits.
* Methods: trust-region dogleg with bounds (TRDL, default), Levenberg–Marquardt with or without bounds,
  Nelder–Mead with bounds. Parameters spanning decades (R, C, Q, τ …) are fitted as ln p internally; the result is
  the same, convergence from poor start values is better.
* Batch fits run in parallel Web Workers. Fit selected uses each dataset's own start values; the usual route for
  many spectra is: fit one, Clone parameters to all, select all, Fit selected.
* Global fit: one fit of all selected datasets. Each parameter is shared (one value) or local (one value per
  dataset), set in the Parameters tab; all shared is the LabVIEW behaviour. Start values: shared ones from the first
  selected dataset, local ones from each dataset.

### Why a fit says "converged: …"

Every normal end of a fit is reported as `converged`, followed by the rule that stopped it (shown when you
point at the status, and in the Log):

* `χ² change below the tolerance`: χ² changed by less than the tolerance (Parameters tab) twice in a row;
* `no step lowers χ² further` or `steps below numerical resolution`: the minimum is reached to the precision of
  the computer, which is the usual end with the very small default tolerance (1e-12);
* `zero gradient`, `simplex collapsed` (Nelder–Mead): the same, seen by other tests.

All are equally good minima. Only `iteration limit reached` (amber dot in the list) means the fit did not finish.

### Normalization

Action → *Normalize* sets, for the selected datasets: none (as measured, Ω), a correction factor (unit unchanged),
the electrode area (Z × A, Ω·cm²) or a resistivity (Z × A / L, Ω·cm). A new choice replaces the previous one, and
*None* brings back the measured values. Fitted parameters are converted at the same time (R and L multiplied, C and
Q divided, n, α, β and τ unchanged), so the fit still matches and needs no new run. Plots, tooltips, parameters,
DRT, report and saved files show the unit; the dataset list shows it next to the name. Save data writes a
`#normalization` line that Read data takes back.

### Contributions

The parts of the series chain are drawn for the first plotted dataset. Clicking a part in the legend hides it (on
the Nyquist plot its colour leaves the model curve too); hiding the dataset hides its parts.

### Masked points

Masked points stay on the plots, hollow and pale, and do not count for autoscale; fits, DRT, Z-HIT and saved data
leave them out. Unmask brings them back.

### History

Before every command or action that changes datasets, a restore point keeps the datasets (data, masks, parameters,
fit results, labels), the selection and the circuit. In the Log tab, the line of each such action has a
*Restore before* button that brings back that state; a restore can itself be restored or undone. `undo` goes back
one step at a time. Restore points live in memory, up to 256 MB (the oldest are dropped first), and are lost when the
page is closed: Save project keeps a state for good.

### Measured errors as weights

With *Use measured standard deviations as weights* (Parameters, Data files), datasets read with standard
deviations (`realzstddev`, `imagzstddev` or `abszstddev` lines of MFLI csv files, `sigma Zr`, `sigma Zi` columns
written by Save data) are fitted with w = 1/σ² for each part. Points without a σ get the median relative error
(σ/|Z|) of the others; with fewer than 3 measured points the usual weight is used. χ²red is then close to 1 for an
adequate model. Error bars are drawn on the Nyquist, Zr and Zi plots.

## DRT, Z-HIT, contributions, labels

* **DRT tab**: distribution of relaxation times of the selected datasets (as in Yappari 5.1, the spectra and peaks shown are those of the first one):
  Z(ω) = R∞ + Rpol ∫ g(τ)/(1 + jωτ) dlnτ with R∞ = Zr at the highest and Rpol = Zr at the lowest frequency minus
  R∞, both from the data. τ is log-spaced over the measured range (at least 10 per decade). Methods: Tikhonov with
  g ≥ 0 (active-set NNLS), Fisk (iterated Tikhonov, relaxation 0.1, stop at 0.25 % change of |g|), Gold
  (multiplicative; the number of iterations regularises, 10⁵ by default). Data: Zr and Zi, Zi only or Zr only.
  The peak table gives f, τ, R = Rpol × area, C = τ/R, useful as start values. *Search λ* scans λ (or Gold
  iterations): it plots the misfit and the re–im cross-validation and suggests the strongest regularisation
  whose misfit stays within 10 % (and 0.1 percentage point) of the best; click the plot to choose another value.
  *Axis* switches all three plots between frequency (g placed at f = 1/(2πτ)) and time constant (spectra placed
  at τ = 1/(2πf)), so the peaks of g line up with the features of the spectra. The distributions of the selected datasets are drawn together
  (at most 12; Gold only the first); spectra, residuals and peaks are those of the first one. *Save DRT…* computes
  every selected dataset with the current settings and saves a summary line per dataset (R∞, Rpol, f, R and C of
  each peak), then each distribution, rebuilt spectrum and peak list.
* **Z-HIT** (Action menu, `zhit`): ln|Z| is rebuilt from the phase,
  ln|Z(ω0)| = C + (2/π)∫φ dlnω − (π/6) φ' − (π³/360) φ''' − (π⁵/15120) φ⁽⁵⁾ − (π⁷/604800) φ⁽⁷⁾ (derivatives in lnω),
  and compared with the measured |Z|. The derivatives come from local polynomials of degree 5 over ±1 decade, so
  φ⁽⁷⁾ counts as 0: a degree-7 fit turns 1 % noise into errors of hundreds of percent, while degree 5 keeps the
  deviation of valid noisy data at the noise level; new datasets `zh_…` hold the result. The phase integral cannot cross a
  gap left by masked points, so each side of such a gap is checked on its own (and the gap is reported).
* **Contributions** (plot toolbar, Model tab, `contrib`): the parts of the top-level series chain add up.
  On the Zr and Zi plots each part of the first plotted dataset is drawn in its colour; on the Nyquist plot the
  model curve takes the colour of the part with the largest |Zi| at each frequency, and each part is drawn alone,
  shifted along Zr as if the relaxations were separate. The circuit drawing uses the same colours.
* **Frequency labels** on the Nyquist plot: *Label frequency…* (or `label>>1k`) labels the point nearest to that
  frequency in every selected dataset; with *Click labels a point*, clicking a point adds or removes its label.

## Reading data

* **3 columns**: f, Zr, Zi, one dataset per file, several files at once. Separator detected or chosen in the
  Parameters tab; decimal commas are accepted whenever the separator is not a comma.
* **Table with column headers**: any other text table whose header names a frequency, a real and an imaginary column
  (`frequency, realz, imagz`, `freq/Hz, Re(Z)/Ohm, -Im(Z)/Ohm`, `Freq, Zreal, Zimag`, `Z'`, `-Z''` …). A `chunk`
  column (Zurich Instruments LabOne) splits the sweeps into datasets; a `-Im` column is negated. Files written by
  Save data read back this way, names included.
* **MFLI csv** (Zurich Instruments LabOne sweeper export, `;` or `,`): one line per field and sweep,
  `chunk;timestamp;size;fieldname;values…`. Each chunk is a dataset (`name_0`, `name_1` …); f comes from the
  `frequency` line (or `grid`), Z from `realz` and `imagz` (or `absz` and `phasez`); points still `nan` are skipped.
* **MFLI ZView .txt and ZView .z**: f, Z' and Z'' are taken from columns 1, 5 and 6; each block of numbers
  is a dataset. A ZView file opened with "3 columns" is recognised and read the same way.
* **VersaStudio .par**: each `<Segment>` with frequency and impedance (or E and I) columns.
* **Custom formats**: files holding several datasets, each starting with the same header text, for example
  `files/Z_MFLI.txt` and `files/hp4192a.txt`. Definitions are the XML files of Yappari 5.1
  (`files/Z_MFLI_datafile_example_template.xml`, `files/custom_hp4192a.xml`); the dialog loads them, has them as
  presets, and saves new ones in the same XML, which the LabVIEW version reads too. Older `.ini` definitions and
  JSON are read as well. Fields, in the order of the XML: header (it can be part of a longer line), label length
  (characters after the header added to the name), data separator, ignore first (lines after the header line),
  frequency, Zr and Zi columns (from 1), ignore last (lines at the end of each dataset; a dataset cut short,
  such as the last one in `Z_MFLI.txt`, keeps all its rows).
* **Dropped files** are read automatically: ZView, VersaStudio, tables with headers, or blocks of three numbers
  separated by text lines (`hp4192a.txt` gives its three cycles). Drop a definition file together with data files
  to read them with it; `.json` projects open directly.

The MFLI csv sample in `files/` stops before the `frequency`, `realz` and `imagz` lines (reading it explains
this); the reader was checked on generated files with the same layout. `files/type_VersaStudio.par` is a
real VersaStudio file.

## Saving

Action menu: parameters of the selected datasets (tab-separated, R², χ²w, χ²red, value and SE % of each
parameter), data (measured and/or model values), report (HTML with statistics, parameters and six plots per
dataset; up to 30 datasets it opens in a new tab), project (JSON with data, masks, circuit, limits, settings,
parameters and statistics). Plots: Save PNG above each plot.

## Command line

`rndz>>x`, `rndzr>>x`, `rndzi>>x`, `rndf>>x` (noise, % of |Z|), `negate_zi`, `spline>>n`, `smooth>>s&d`,
`average`, `fit`, `globalfit`, `clone_all`, `clone_active`, `mask`, `unmask`, `simulate`, `select>>text`,
`label>>f`, `unlabel`, `contrib`, `drt`, `drt_save`, `drt_search`, `zhit`, `demo`, `help`, and `undo`, which goes
back one step (repeat to go further).
They act on the selected datasets.

The switch at the top right turns dark mode on and off; the first choice follows the system setting.

## Differences from Yappari 5.1 (LabVIEW)

* Circuits of any depth instead of ten slots; readable parameter names instead of 4ZARR, 2MR1D …
* JSON project files. Custom-format definitions stay the Yappari 5.1 XML files, read and written.
* Standard errors for all methods, global fit with shared and local parameters.
* No dependence on the Windows decimal separator.

## Citing

N. Dragoe, Materials Lab 2024, 3, 230031, https://doi.org/10.54227/mlab.20230031
