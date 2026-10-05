# Yappari JS

*Yet Another Program for Analysis and Research in Impedance*, browser version of
[Yappari 5.1](https://nitad54448.github.io/yappari-5-1/) (LabVIEW) by Nita Dragoe, Université Paris-Saclay, ICMMO.
One equivalent circuit is fitted to one or to thousands of impedance spectra; the distribution of relaxation
times (DRT), the Z-HIT check and a Kramers–Kronig test (Lin-KK) complete the analysis.

Open `index.html` in Chrome, Edge or Firefox. A double-click is enough: no server, no installation, and nothing is
uploaded, all computations run in your browser. The same folder can be published on GitHub Pages. Settings, the last
circuit, the element start values and the layout (tabs, side panel width) are remembered by the browser
(localStorage).

**Contents**

1. [Quick start](#1-quick-start)
2. [The window](#2-the-window)
3. [Reading data](#3-reading-data)
4. [Building the circuit](#4-building-the-circuit)
5. [Circuit elements and equations](#5-circuit-elements-and-equations)
6. [Fitting](#6-fitting)
7. [Global fit](#7-global-fit)
8. [Plots](#8-plots)
9. [Distribution of relaxation times (DRT)](#9-distribution-of-relaxation-times-drt)
10. [Z-HIT](#10-z-hit)
11. [Kramers–Kronig test](#11-kramerskronig-test)
12. [Data operations](#12-data-operations)
13. [Saving](#13-saving)
14. [History, undo and the Log](#14-history-undo-and-the-log)
15. [Settings reference](#15-settings-reference)
16. [Command line](#16-command-line)
17. [Mouse and keyboard](#17-mouse-and-keyboard)
18. [Files of the program, tests](#18-files-of-the-program-tests)
19. [Differences from Yappari 5.1](#19-differences-from-yappari-51-labview)
20. [Citing](#20-citing)

---

## 1. Quick start

1. **Read data**: *File → Auto: detect the format*, a specific format in *File*, or simply drop files on the window. To try the program,
   *File → Load 24 demo spectra* (or type `demo` in the command line).
2. **Build the circuit** in the **Model** tab: click elements of the palette, pick a template, or type a circuit
   code such as `R(RQ)(RQ)` and press *Apply*.
3. **Select a dataset** in the side panel (**Datasets** tab).
4. **Set start values** in the **Parameters** tab: type a value or turn the mouse wheel over it. Tick the
   parameters to fit.
5. **Fit**: *Fit* in the top bar (or F9 from anywhere).
6. **Many spectra**: once one dataset fits well, *Parameters → Copy these values to: All datasets*, select all
   datasets (Ctrl+A in the list) and press *Fit*: they are fitted in parallel, each from its own start
   values. Switch the mode to **Global** to fit them together with shared parameters.
7. **Save**: *File → Save parameters of selected*, *Save data of selected…*, *Report of selected datasets* or
   *Save project* (Ctrl+S).

---

## 2. The window

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ EIS  Model  DRT  Log  About                       File▾ Data▾ Analysis▾ │ ⚙ Settings  Dark │
├───────────────────────────────────────────────────────────────┬──────────────────────────┤
│ plot toolbar (views, Autoscale, Save PNG, Show …)             ┃ Datasets │Parameters│ Fit │
│                                                               ┃                          │
│                     workspace of the tab                      ┃   content of the side    │
│                                                               ┃   tab                    │
│                                                               ┃                          │
├───────────────────────────────────────────────────────────────┴──────────────────────────┤
│ ? › command line                     status message                      progress (fits) │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**Top tabs (workspaces)**

| Tab | Content |
|---|---|
| **EIS** | The plots of the selected datasets. The plot type is chosen in the toolbar: Nyquist, Zr, Zi, \|Z\| and θ (Bode), 3D. |
| **Model** | Circuit code, element palette, templates, circuit drawing, table of element equations. |
| **DRT** | Distribution of relaxation times, rebuilt spectrum, residuals and peak table, one view at a time. |
| **Log** | Every action and message, with *Restore before* buttons (see [History](#14-history-undo-and-the-log)). |
| **About** | Short help, mouse and keys, citation. |
| **⚙ Settings** | Fit, data files, simulation and plot settings; parameter limits and *shared* flags; start values of new elements; settings file. |

The **Dark** switch toggles dark mode; the first choice follows the system setting.

All colours, fonts and sizes come from the variables at the top of `style.css`: the page, the plots (dataset colours
`--series-1…`, contributions `--part-1…`, DRT `--drt-…`, font sizes, marker size, line width), the circuit drawing and the
report, which always uses the light values. The dark theme is one block that overrides some of them. Colours read by
the plots must be plain values (#hex, rgb(), rgba()).

**Menus** (header, left of Settings)

| Menu | Items |
|---|---|
| **File** | Read: Auto (detect the format) · **separator** · 3 columns · Table with column headers · ZView · **separator** · BioLogic MPT · Gamry DTA · VersaStudio .par · Custom format, xml. Open project · Save project. Save parameters of selected · Save data of selected · Report of selected datasets. Load 24 demo spectra. |
| **Data** | Undo the last command. Mask points in the current view · Unmask selected datasets · Delete points in the current view · Delete selected datasets. Normalize · Negate Zi. Add random noise · Spline to a log frequency grid · Smooth (Savitzky–Golay) · Average selected datasets. Simulate spectrum. |
| **Analysis** | Show / Save the DRT of selected datasets · DRT λ search. Z-HIT of selected datasets · Kramers–Kronig test of selected datasets. Label a frequency on the Nyquist plot · Clear Nyquist labels. Command line help. |

Items that cannot run in the current situation are greyed out, and their tooltip says why: no data loaded, no dataset
selected, no circuit, no masked points to unmask, no labels to clear, nothing to undo, a fit running, and so on. The
*Fit*, *Copy these values to*, *Label frequency*, *Clear labels*, *Save PNG* and DRT buttons follow the same
rules. The command line and the keyboard shortcuts still run the commands, which then say in the status line why not.

**Side panel**

| Tab | Content |
|---|---|
| **Datasets** | All datasets, newest on top. Colour square = plot colour; dot on the right = fit status (green converged; amber iteration limit, stalled, singular system or all fitted parameters at their limits; red failed). Selected datasets are amber. |
| **Parameters** | Values of the dataset shown (the first selected one, or the one browsed to with ← →): name, value, unit, standard error (%), fit tick box (a dash when the selected datasets disagree; the tooltip gives the count, a click fits the parameter in all; in Global mode a padlock before it shows shared or local). Below: χ²w, χ²red, R², weights, fit status. At the bottom: *Copy these values to All datasets / Selected datasets*. The arrows ← → right of the dataset name (cut with … when it is long; the whole name shows on hover) show the previous or next dataset: with several datasets selected they cycle through those, and the selection is kept; with one selected they select the previous or next dataset of the list. |
| **Fit** | What will be fitted (number of selected datasets, circuit), mode **Individual** or **Global**, method, weights, max iterations, min χ² step (relative tolerance) and *Stop*. The **Fit** button is in the top bar, immediately left of Settings. All four fit settings stay synchronized with Settings. |

Drag the **left edge of the side panel** to resize it (arrow keys when it has the focus; double-click resets).
The **?** at the bottom left lists the commands of the command line. The progress bar appears in the status bar
only while a job runs.

---

## 3. Reading data

All formats are in *File*. Several files can be chosen at once.

* **Auto: detect the format** (also used for dropped files): each file is matched against the `<detect>` rules of the
  presets in `config/definitions/` (highest priority first), then against the built-in recognisers (VersaStudio,
  Gamry DTA, BioLogic MPT, ZView, MFLI CSV, Yappari JS Save data), then read as a table with column headers or as
  blocks of three numbers. The status line names the format used. A preset that matches but cannot read the file
  is reported and the next candidate is tried. When `index.html` is opened from disk (`file://`) the presets cannot
  be fetched and only the built-in recognisers are used.
Each spectrum becomes a **dataset** holding the frequency f (Hz), Zr and Zi (Ω, Zi negative for capacitive
behaviour). Text files are read as UTF-8, or as UTF-16 when they are written that way (*Unicode text* of Excel or
Notepad, recognised from the start of the file).

* **3 columns**: f, Zr, Zi, one dataset per file. The separator is detected or set in *Settings → Data files*;
  decimal commas are accepted whenever the separator is not a comma.
* **Table with column headers**: any text table whose header names a frequency, a real and an imaginary column
  (`frequency, realz, imagz`, `freq/Hz, Re(Z)/Ohm, -Im(Z)/Ohm`, `Freq, Zreal, Zimag`, `Z'`, `-Z''` …): EC-Lab,
  Gamry and similar exports. A `chunk` column (Zurich Instruments LabOne) splits the sweeps into datasets; a
  `-Im` column is negated (typographic signs such as `−Z″` count as `-Z''`). Without real and imaginary columns, a
  modulus and a phase (`|Z|`, `Zmod` …; `Phase`, `Zphz`, `θ` …, in degrees unless the heading says rad) are
  converted. Dropped files whose headings name a frequency but no such columns are read by position (f, Zr, Zi)
  with a warning. Files written by *Save data* are read back this way, names, normalization and masked
  points included.
* **MFLI CSV preset** (`MFLI_csv.xml`, through Custom format, xml) (Zurich Instruments LabOne sweeper export, `;` or `,`): one line per field and sweep,
  `chunk;timestamp;size;fieldname;values…`. Each chunk is a dataset (`name_0`, `name_1` …); f comes from the
  `frequency` line (or `grid`), Z from `realz` and `imagz` (or `absz` and `phasez`, the phase in radians); points
  still `nan` are skipped. Standard deviations (`realzstddev`, `imagzstddev`, `abszstddev`) are kept for weighting.
* **ZView .z / .txt** (also available as the `MFLI_ZView.xml` custom preset): f, Z′ and Z″ from columns 1, 5 and 6; each block of numbers is a dataset. A ZView
  file opened with *3 columns* is recognised and read the same way.
* **BioLogic MPT**: EC-Lab ASCII text exports, not binary `.mpr` files. Reads the declared header-line count
  when present and resolves impedance columns by heading, including conversion of `-Im(Z)` to Zi. A `cycle number`
  column separates cycles into datasets; without it, each recognized impedance table becomes one dataset.
  Empty or invalid numerical rows are skipped and reported. This imports impedance arrays, not all EC-Lab metadata.
* **Gamry DTA**: tab-delimited text containing `ZCURVE TABLE` (or numbered `ZCURVE` sections).
  Resolves frequency, real and imaginary impedance by their column headings, skips the units row, and imports
  multiple impedance sections as separate datasets. Non-impedance tables are ignored. Files without an impedance
  section are rejected; numerical data is not guessed by column position.
* **VersaStudio .par**: each `<Segment>` with frequency and impedance (or E and I) columns.
* **Custom format, xml** (Yappari JS 1.5 and later): select a filename from
  `config/definitions/index.json`, load a definition, or edit the fields. Definitions use the
  application-native XML format (versions 1 to 3). Version 2 adds specialized file layouts; version 3 adds
  `<detect>` rules for *Auto* and the Gamry, BioLogic, VersaStudio and column-header layouts. The dialog supports single datasets,
  repeated literal headers, blank-line blocks, full or truncated labels, end markers, line skipping,
  Cartesian/polar impedance, unit conversions, imaginary sign reversal, explicit delimiters and decimal
  separators, comments, missing values and invalid-row policies. Preview data before importing it.
  Save definition downloads XML version 3. LabVIEW XML, INI and JSON definitions of Yappari 5.1 are no longer read.

  Presets require HTTP(S) hosting (including GitHub Pages). Add your XML to `config/definitions/` and
  its filename to the `definitions` array in `index.json`; no Actions or build step is needed.
  The filename list is refreshed whenever the dialog opens, and the selected XML is fetched when chosen.
  See `config/definitions/README.md` for the schema and supported options.

* **Yappari JS export preset** (`Yappari_JS.xml`): reads files produced by Save data. Choose
  **Impedance to load**: Measured Zr, Zi; Model Zr, Zi; or Measured if present, otherwise model.
  Columns are found by heading for each dataset, so optional uncertainty columns do not shift the selection.
  Explicit measured/model choices report an error if that pair is missing in any dataset; they do not silently
  substitute the other pair. Dataset names, normalization and masks are restored. Measured uncertainties are
  retained for measured data only; they are not assigned to model data. DRT sections are excluded.

### Custom reading: local index.html versus a server

Opening `index.html` by double-click normally uses a `file://` URL. Browsers generally block the automatic
fetches of `config/definitions/index.json` and the XML presets in this mode. Therefore the Preset list may
show **Presets unavailable**, even though the files exist alongside index.html. Editing index.json alone
cannot overcome that browser restriction.

Custom reading still works locally: open File → Custom format, xml → **Load definition…**, select an XML
file explicitly, then use **Preview data…** or **Choose data files…**. You can also enter manual settings,
or select a specialized File layout directly, including Yappari JS and its measured/model choice. Saving
an XML definition downloads a file; it never writes into config/definitions or updates index.json automatically.

For automatic presets, serve the whole application directory over HTTP(S), including GitHub Pages or a
local server. If Python is installed, run `python -m http.server 8000` from that directory and visit
`http://localhost:8000/`. The browser still performs all parsing and calculations locally; selected measurement
files are not uploaded to the static server. After publishing updates, hard-refresh to avoid old cached scripts.


* **Open project**: a `.json` project written by *Save project* (also opens when dropped). The Log saved with it is
  shown in the Log tab, with its dates, and the Log kept for the project continues from it.
* **Dropped files** are read as with *File → Auto*. Drop an XML definition together with data files to read them
  with it instead.

The example files in `files/` cover each format. The MFLI csv sample stops before the `frequency`, `realz` and
`imagz` lines (reading it explains this); `files/type_VersaStudio.par` is a real VersaStudio file.

---

## 4. Building the circuit

### Circuit description code

Boukamp's code. Elements written next to each other are in **series**; `( )` puts its content in **parallel**;
`[ ]` puts its content in **series inside a parallel group**:

```
R(RQ)(Q[RW])   =   R1 + (R2 ‖ Q1) + (Q2 ‖ (R3 + W1))
```

Any depth of nesting is allowed. Numbers name the elements (`R1`, `Q2`); missing numbers are added, so the code
shown is always numbered: `R1(R2Q1)(Q2[R3W1])`. Spaces, commas and dashes are ignored. Editing the circuit keeps
the values of the parameters whose element still exists, and an element that comes back (Undo) gets its old values
back. The green dot next to *Apply* shows that the code is valid and applied.

### Drawing editor (Model tab)

1. Click an element or a group in the drawing (a group is selected by clicking its dashed outline). With nothing
   selected, new elements go at the end of the chain.
2. Choose where the next element goes: **In series**, **In parallel** or **Replace**.
3. Click an element of the palette, or pick a **template**.

*Delete* removes the selection, *Undo* (Ctrl+Z) undoes the last edit, *Clear* empties the circuit, Esc deselects.
*Show contributions* (or `contrib`) colours each part of the series chain in the drawing, with the colours of the
contributions on the plots (see [What is drawn](#what-is-drawn)).

**Templates**: R‖C `(RC)`; Zarc R‖Q `(RQ)`; R and Q in series `RQ`; Randles `R(Q[RW])`, with short `R(Q[RWs])` or
open `R(Q[RWo])` Warburg; two Zarcs `(RQ)(RQ)`; Rs + two or three Zarcs `R(RQ)(RQ)`, `R(RQ)(RQ)(RQ)`;
`(Q[R(RQ)])`; leads L + R `LR`; R‖L `(RL)`; R‖W `(RW)`; R + Gerischer `RG`; three RC in series (Voigt)
`(RC)(RC)(RC)`.

### Combination rules

$$Z_\text{series} = \sum_i Z_i \qquad\qquad \frac{1}{Z_\text{parallel}} = \sum_i \frac{1}{Z_i}$$

with ω = 2πf and j² = −1. Zr = Re Z, Zi = Im Z.

---

## 5. Circuit elements and equations

| Code | Element | Impedance | Parameters (element 1) | Default, limits |
|---|---|---|---|---|
| R | Resistor | $Z = R$ | `R1` (Ω) | 100; 10⁻³ – 10¹⁰ |
| C | Capacitor | $Z = \dfrac{1}{j\omega C}$ | `C1` (F) | 10⁻⁹; 10⁻¹⁶ – 10³ |
| L | Inductor | $Z = j\omega L$ | `L1` (H) | 10⁻⁶; 10⁻¹⁵ – 10³ |
| Q | Constant phase element | $Z = \dfrac{1}{Q\,(j\omega)^{n}}$ | `Q1` (F·sⁿ⁻¹), `Q1_n` | Q 10⁻⁹; n = 1 (not fitted by default), 0 – 1.2 |
| W | Warburg, semi-infinite | $Z = \dfrac{A_w}{\sqrt{\omega}}\,(1 - j)$ | `W1` = A_w (Ω·s^−½) | 100; 10⁻⁶ – 10¹⁰ |
| Wo | Warburg open (finite length, reflective) | $Z = \dfrac{A_w}{\sqrt{j\omega}}\,\coth\!\left(B\sqrt{j\omega}\right)$ | `Wo1_A`, `Wo1_B` (s^½) | A 100; B 1, 10⁻⁶ – 10⁶ |
| Ws | Warburg short (finite length, transmissive) | $Z = \dfrac{A_w}{\sqrt{j\omega}}\,\tanh\!\left(B\sqrt{j\omega}\right)$ | `Ws1_A`, `Ws1_B` (s^½) | A 100; B 1, 10⁻⁶ – 10⁶ |
| G | Gerischer | $Z = \dfrac{R}{\sqrt{1 + j\omega\tau}}$ | `G1_R`, `G1_tau` (s) | R 100; τ 10⁻³, 10⁻¹² – 10⁶ |
| HN | Havriliak–Negami | $Z = \dfrac{R}{\left(1 + (j\omega\tau)^{\alpha}\right)^{\beta}}$ | `HN1_R`, `HN1_tau`, `HN1_a`, `HN1_b` | α, β = 1 (not fitted by default), 0.01 – 1 |

Remarks:

* **Q** with n = 1 is a capacitor, n = 0.5 a Warburg, n = 0 a resistor. For a Zarc (R‖Q) the equivalent capacitance
  is $C = (R^{1-n} Q)^{1/n}$ and the peak frequency $f_0 = 1/\left(2\pi (RQ)^{1/n}\right)$.
* **W, Wo, Ws** follow Yappari's theory notes. For large B, Wo and Ws tend to W with an A_w larger by √2. At low
  frequency Wo behaves as a capacitor, $Z_{Wo} \to 1/(j\omega C)$ with $C = B/A_w$, and Ws as a resistance,
  $Z_{Ws} \to A_w B$.
* **HN** includes Cole–Cole (β = 1) and Cole–Davidson (α = 1); α = β = 1 is a Debye (R‖C) relaxation with τ = RC.
* The composite elements of the LabVIEW version (Randles variants, M00x) are templates.
* Default values and limits of new elements can be changed in *Settings → Start values for new elements*.

The table *Element equations and parameter names* at the bottom of the Model tab repeats these equations.

---

## 6. Fitting

### Quantity minimised

$$\chi^2_w = \sum_{k=1}^{N} w_k\left[\left(Z_{r,k} - Z^{\text{calc}}_{r,k}\right)^2 + \left(Z_{i,k} - Z^{\text{calc}}_{i,k}\right)^2\right]$$

over the N unmasked frequencies, with the weight (Fit tab or Settings):

| Weight | $w_k$ | Use |
|---|---|---|
| 1/\|Z\| (default) | $1/\lvert Z_k\rvert$ | Yappari default, compromise |
| 1/\|Z\|² | $1/\lvert Z_k\rvert^2$ | Relative (proportional) errors, all decades count equally |
| 1 | 1 | Absolute errors, large impedances dominate |
| measured σ | $1/\sigma_{r,k}^2$ and $1/\sigma_{i,k}^2$ for each part | When the file gives standard deviations (option in Settings) |

|Z| is the measured modulus. Measured σ come from the `realzstddev`, `imagzstddev` or `abszstddev` lines of MFLI csv
files and from the `sigma_Zr`, `sigma_Zi` columns written by *Save data* (the older `sigma Zr` headers are read too).
Points without a σ get the median relative error (σ/|Z|) of the others; with fewer than 3 measured points the usual
weight is used. χ²red is then close to 1 for an adequate model,
and error bars are drawn on the Nyquist, Zr and Zi plots.

### Statistics

* Reduced chi-square, with p fitted parameters (real and imaginary parts both counted):

  $$\chi^2_\text{red} = \frac{\chi^2_w}{2N - p}$$

* Coefficient of determination on the stacked, unweighted vector (Zr, Zi):

  $$R^2 = 1 - \frac{\sum (Z - Z^\text{calc})^2}{\sum (Z - \bar Z)^2}$$

* Standard errors, in % of the value:

  $$\mathrm{SE}(p_j) = \frac{100}{\lvert p_j\rvert}\sqrt{\left[\chi^2_\text{red}\,(J^\mathsf{T}J)^{-1}\right]_{jj}}$$

  with J the Jacobian of the weighted residuals at the solution (central differences). Given for every method; a
  parameter that ends on a limit gets none. On simulated spectra with noise matching the weights, these errors agree
  with the scatter of repeated fits. Large errors (tens of %) or strongly correlated parameters usually mean the
  data do not determine that parameter: fix it or simplify the circuit.

### Methods

| Method | Description |
|---|---|
| **TRDL** (default) | Trust-region dogleg with box bounds (dogbox variant). Robust, respects the limits. |
| **LMB** | Levenberg–Marquardt with bounds (projection). |
| **LM** | Levenberg–Marquardt without bounds (limits ignored). |
| **NM** | Nelder–Mead simplex with bounds. No derivatives; slower, useful from poor start values. |

Parameters spanning decades (R, C, L, Q, A_w, B, τ) are fitted internally as $x = \ln p$: they stay positive and
values of very different size are handled evenly; the solution is the same. A lower limit of 0 keeps this; with a
negative lower limit the parameter is fitted linearly, scaled by its start value. n, α and β are varied in absolute
steps. Limits are set per parameter in *Settings → Parameter limits for the current circuit*; a value typed outside
them is brought back to the nearest limit.

### Running fits

* **Individual** mode: each selected dataset is fitted on its own, from its own start values, in parallel Web
  Workers (the status bar shows how many). *Stop* ends a running batch at once: the datasets already fitted keep
  their results, the fits still running are abandoned (their workers are replaced) and those datasets keep their
  values. A running global fit is stopped at once and its result discarded (parameters unchanged).
* A worker that stops by itself (in practice out of memory) is replaced by a fresh one, and the fit it was running
  is tried once more there; a fit that stops a worker twice is reported as failed. Fits run in this window only
  when the browser cannot start workers at all.
* A fit that stops on tiny steps is checked with one Gauss-Newton step; if χ² could still drop noticeably it is
  reported as *stalled, not a minimum* (amber), not as converged.
* Fit flags (the tick boxes) are per dataset and are copied with the values by *Copy these values to …*.
  See [Parameters panel with several datasets](#parameters-panel-with-several-datasets).
* Start values: type them, or turn the mouse wheel over a value (Shift: larger steps, Alt: smaller), or use the
  arrow keys. The model curve follows immediately.
* *Simulate spectrum* (Data menu) creates a dataset from the circuit and the current values over the frequency range
  set in *Settings → Simulation*.

### Parameters panel with several datasets

The panel shows the values of one selected dataset, the first one of the list until ← → are used; *and N more*
next to its name tells how many others are selected. With several datasets selected, ← → cycle through **the
selected datasets only** and keep the selection, so the marks below stay valid while browsing. To work on one
dataset alone, select only that one in the Datasets tab; ← → then step through the whole list. Every change made here applies to **all selected datasets**: a typed value, a mouse-wheel or
arrow-key step, a fit tick, a shared/local padlock. One restore point covers the change for all of them.

| What you see | Meaning | A click |
|---|---|---|
| ☑ fit tick | Fitted in every selected dataset | Holds it fixed in all |
| ☐ empty tick, grey name and value | Held fixed in every selected dataset | Fits it in all |
| ▬ amber dash in the tick box | *Mixed*: fitted in some selected datasets only (the tooltip gives the count, e.g. 2 of 5) | Fits it in all |
| 🔒 grey closed padlock (Global mode only) | Shared: one value for all datasets in the global fit | Makes it local |
| 🔓 amber open padlock (Global mode only) | Local: one value per dataset in the global fit | Makes it shared |
| ±x % next to the value | Standard error of the last fit; amber *limit* when the parameter ended on a limit | — |

The padlocks appear only when the Fit tab is set to **Global**, and are dimmed for parameters held fixed. Shared or
local is a property of the circuit's parameter (the same as the *shared* column of *Settings → Parameter limits*),
not of a dataset. Amber marks what deserves a look: a mixed tick (an individual fit then fits different parameters
in different datasets; a global fit uses the ticks of the dataset shown, see below) or a local parameter in a
global fit.

### End of a fit

Every normal end is reported as `converged`, followed by the rule that stopped it (status bar, Parameters tab, Log):

* `χ² change below the tolerance`: χ² changed by less than the tolerance (Settings, relative) twice in a row;
* `no step lowers χ² further` or `steps below numerical resolution`: the minimum is reached to the precision of the
  computer, the usual end with the very small default tolerance (10⁻¹²);
* `zero gradient`, `simplex collapsed` (Nelder–Mead): the same, seen by other tests.

All are equally good minima. The other ends have an amber dot in the list:

* `iteration limit reached`: the fit did not finish; raise *Maximum iterations* or improve the start values;
* `stopped: … not a minimum` (stalled): see *Running fits*;
* `singular system`: the parameters ticked cannot all be determined by the data; fix one or simplify the circuit;
* `all fitted parameters are at their limits`: check the limits in Settings.

A converged fit can still be a local minimum: compare χ²red after starting from different values.

---

## 7. Global fit

**Fit tab → Global**, then *Fit* in the top bar (or F9): one fit of all selected datasets with one circuit. Each fitted
parameter is

* **shared**: one value for all datasets (ticked *shared* in *Settings → Parameter limits*; the default, which is
  the LabVIEW behaviour), or
* **local**: one value per dataset (untick *shared*).

In Global mode the Parameters panel shows a padlock before each fit tick: closed (grey) = shared, open (amber) = local;
click it to switch (see [Parameters panel with several datasets](#parameters-panel-with-several-datasets)). The fit
ticks of the dataset shown in the Parameters panel decide which parameters are fitted; when the selected datasets disagree (amber
dash in the tick box), a warning names the parameters concerned before the fit starts (Continue or Cancel).

Shared parameters start from the dataset shown in the Parameters panel, local ones from each dataset's own values. The fit is a
Levenberg–Marquardt on the block-arrow normal equations (Schur complement on the shared block), so hundreds of
datasets with local parameters stay cheap. χ²w is the sum over all datasets; χ²red uses $2\sum N - p_\text{total}$.
Bounds are kept as in a single fit, except with method LM: a parameter on a limit is held while the χ² gradient
points outwards, and the steps of the others are projected into the limits. Typical uses: a series of spectra at several temperatures
with a common geometric capacitance, or spectra where a shared n of a CPE is wanted.

Standard errors come from the covariance of all the parameters together. As in a single fit, a parameter that ends
on a limit gets none and is held fixed for the others. A local parameter that the data of its dataset cannot
determine (it has no effect, or cannot be told apart from another one) gets none either; the other standard errors
are not affected.

---

## 8. Plots

### Views (EIS tab)

| View | x | y | Below |
|---|---|---|---|
| **Nyquist** | Zr | −Zi | — |
| **Zr** | f (log) | Zr | Residuals of Zr |
| **Zi** | f (log) | Zi | Residuals of Zi |
| **\|Z\|, θ** | f (log) | \|Z\| (log) | Phase θ = atan2(Zi, Zr), degrees or radians |
| **3D** | Zr or f | dataset index | −Zi, Zr, Zi, model or differences (View selector) |

Residuals are $Z - Z^\text{calc}$, absolute (unit of Z) or relative (% of |Z|), set in Settings. The Nyquist plot
uses the same scale on both axes unless unticked in Settings. *Square* (Nyquist toolbar or Settings) makes its frame
and the saved image square, so that with the same scale both axes span the same range. Large selections are thinned out evenly for drawing
(*Datasets drawn at most*, Settings); fits always use all datasets.

### What is drawn

Click a legend entry to hide or show it; double-click the plot to show everything again:

* **Data**: the measured points of each dataset (its legend entry hides only these points).
* **Fit**: the model curves with the current parameters, one legend entry *Fit* for all datasets.
* **Contributions** (Nyquist, Zr, Zi; switched on with *Show contributions* in the Model tab, or `contrib`): the parts of the top-level series chain, dashed, each in its colour, for the
  first plotted dataset. They add up exactly: $Z = \sum_\text{parts} Z_\text{part}$. On the Zr and Zi plots each part
  is drawn as is. On the Nyquist plot the model curve takes, at each frequency, the colour of the part with the
  largest |Zi|, and each part is drawn alone, shifted along Zr as if the relaxations were separate (series
  resistances as thick segments on the axis). The circuit drawing can use the same colours. Hiding a part from the
  legend also takes its colour off the Nyquist model curve; hiding the dataset hides its parts.

Any combination works: data with contributions and no fit curve, contributions alone, and so on. Hidden entries
reappear when the selection changes. Reports always include data and model curve.

### Frequency labels

*Label frequency…* (or `label>>1k`) labels the point nearest to that frequency, masked or not, in every selected
dataset on the Nyquist plot; with *Click labels a point*, clicking a point adds or removes its label. *Clear labels*
removes them.

### Mouse

Drag to zoom on a rectangle, Shift-drag or right-drag to pan, wheel to zoom, double-click to autoscale and show all
hidden entries. Hovering a point shows its frequency, values and the model values. *Save PNG* exports the current
plot (with its residual plot).

### Masked points

*Data → Mask points in the current view* masks the unmasked points inside the visible rectangle of the plot on
screen (Nyquist, Zr, Zi or |Z|, θ); zoom on the points first. *Unmask selected datasets* brings them back.

Masks apply to fits only: a masked point is left out of every fit, and everything else uses it.

* **Plots**: masked points stay on the plots, hollow and pale. They do not count for autoscale, and the 3D view
  does not draw them (both are display only).
* **DRT, Z-HIT, the Kramers–Kronig test, average, spline and smooth** use masked points. Z-HIT still reports a real gap
  in the frequencies, for example after points are deleted.
* **Save data** writes every point, with a `masked` column (1 = masked). Reading the file back with *Table with
  column headers* restores the masks.
* **Frequency labels** can sit on masked points: masking a labelled point leaves its label in place.
* **Delete points in the current view** removes every point in view, masked or not, for good; the confirmation
  says how many of them are masked.

---

## 9. Distribution of relaxation times (DRT)

The **DRT** tab shows the distributions of the selected datasets (at most 12 are drawn; with Gold only the first);
the spectrum, residuals and peaks shown are those of the first selected dataset.

### Model

$$Z(\omega) = R_\infty + R_\text{pol}\int_{-\infty}^{\infty} \frac{g(\tau)}{1 + j\omega\tau}\,d\ln\tau, \qquad \int g(\tau)\,d\ln\tau = 1$$

* $R_\infty$ is fitted together with g: one more unknown (≥ 0, not regularised) of the same least squares;
  $R_\text{pol}$ is the area of the fitted distribution. With Zi alone, $R_\infty$ is the mean of what remains of Zr.
  (Yappari 5.1 took $R_\infty$ = Zr at the highest frequency, too high when the high-frequency arc is not complete:
  on the demo spectra 705 Ω instead of 50 Ω, the missing part showing up as extra peaks.)
* τ is log-spaced over $1/\omega_\text{max} … 1/\omega_\text{min}$ with the density of the data, at least 10 points
  per decade (so gaps in the frequencies leave no holes in g) and at most 20 (the cost grows as the cube of the
  number of τ values, so dense sweeps stay fast). Masked points are used.
* Discretised, the problem is $A\,x = y$, where x holds $R_\infty$ and g and y the chosen parts of Z, all divided by
  the span of Zr (Zr at the lowest minus Zr at the highest frequency, close to $R_\text{pol}$), which makes λ
  independent of the size of the impedance.

### Toolbar

* **Method**:
  * **Tikhonov (NNLS)**: $\min_g \lVert A g - y\rVert^2 + \lambda^2\lVert g\rVert^2$ with $g \ge 0$
    (active-set non-negative least squares, Bro & De Jong).
  * **Fisk**: iterated Tikhonov, starting from the Tikhonov solution:
    $g \leftarrow \max\!\left(0,\; g + 0.1\,(A^\mathsf{T}A + \lambda^2 I)^{-1} A^\mathsf{T}(y - A g)\right)$,
    stopped when |g| changes by less than 0.25 %.
  * **Gold**: multiplicative deconvolution of the non-negative system; the number of iterations regularises
    (50 000 by default, 100 to 100 000 with the slider; fewer = smoother).
* **Data**: Zr and Zi, Zi only or Zr only.
* **λ** (or iterations for Gold): slider and value. Larger λ = smoother g, larger misfit.
* **Show**: g (distribution), Spectrum (measured and rebuilt Zr, −Zi), Residuals (|ΔZ|), Peaks (table).
* **Axis**: frequency (g placed at $f = 1/(2\pi\tau)$) or time constant (spectra placed at $\tau = 1/(2\pi f)$), for all
  views, so the peaks of g line up with the features of the spectra.
* **Autoscale**, **Search λ…**, and on the right **Save DRT…** and **Save PNG** (the view shown).

### Choosing λ: Search λ

Scans λ from 10⁻⁶ to 1 (or Gold iterations from 100 to 50 000) and plots the rms misfit of the DRT and a re–im cross-validation (Zr predicted by a DRT
of Zi alone, its R∞ the mean of what remains of Zr, compared with the measured Zr, for information). The suggested value is the strongest regularisation
whose misfit stays within 10 % (and 0.1 percentage point) of the best one: the elbow where more smoothing starts to
cost accuracy. Click the plot to choose another value.

### Peaks

For each peak of g: $f = 1/(2\pi\tau)$, $\tau = \exp(\text{g-weighted mean of } \ln\tau)$,
$R = R_\text{pol} \times \text{area of the peak}$, $C = \tau / R$, and the fraction of $R_\text{pol}$. Useful as start
values: each peak is roughly one R‖C (or R‖Q) element. The line below the table gives $R_\infty$, $R_\text{pol}$,
$\int g\,d\ln\tau$, the misfit, and the grid size.

### Save DRT

Computes every selected dataset with the current settings and saves a text file: a summary line per dataset
($R_\infty$, $R_\text{pol}$, misfit, and f, R, C of each peak), then each distribution, rebuilt spectrum and peak list.

---

## 10. Z-HIT

*Analysis → Z-HIT of selected datasets* (or `zhit`) checks the consistency of a spectrum (Kramers–Kronig type): ln|Z|
is rebuilt from the phase φ and compared with the measured |Z|. Large selections are computed one dataset at a time, with the progress
bar.

$$\ln\lvert Z(\omega_0)\rvert = C + \frac{2}{\pi}\int^{\omega_0}\varphi\,d\ln\omega - \frac{\pi}{6}\varphi' - \frac{\pi^3}{360}\varphi''' - \frac{\pi^5}{15120}\varphi^{(5)} - \frac{\pi^7}{604800}\varphi^{(7)}$$

Derivatives are with respect to ln ω; phase is in radians. The phase is first unwrapped: going up in frequency,
2π is added or subtracted where it jumps by more than π, so a phase crossing ±180° (Zr < 0) stays continuous;
ordinary spectra (Zr > 0) are not changed. It is then interpolated on a uniform ln ω
grid (natural cubic spline, at least 10 points per decade). By default, local degree-5 polynomial fits
over a two-decade window estimate the first, third and fifth derivatives; the seventh-derivative term
is zero. The integration constant C is the median difference between measured and reconstructed
ln|Z| within each checked range. The reconstructed impedance retains the measured phase.

**Endpoint treatment**

At the first and last frequencies, a centered polynomial window is unavailable. Evaluating third and
fifth derivatives at the edge of a shifted degree-5 fit can create an artificial bend in the reconstructed
Nyquist curve, even for smooth data. Within one decade of each range boundary, the correction now
smoothly transitions to the first-derivative term alone. Its slope comes from a local quadratic fit
over approximately half a decade (at least five interpolated grid points). At a boundary the higher-order
terms have zero weight; one decade inward the original full correction has full weight. The blend is
`t²(3 − 2t)`, with `t` the distance to the nearest endpoint in decades, limited to 1.

This is a numerical stabilization, not an exact reconstruction of missing phase outside the measured
range. It uses only phase and frequency: no pointwise adjustment to measured |Z| is made. The one
global normalization constant per range is still determined as described above. Edge errors can remain,
especially when a relaxation lies near a boundary; endpoint agreement is not guaranteed.
With a non-default `win`, the transition distance and local slope window scale in proportion to `win`;
with `deg=1`, the local slope fit is linear rather than quadratic.

**Eligibility and numerical safeguards**

- Each continuous range needs at least **10 distinct frequencies spanning at least 2 decades** (a factor
  of 100 in frequency). A dense but narrow sweep does not qualify. This conservative implementation
  rule keeps the full derivative window available; it is not a universal mathematical limit of Z-HIT.
- Frequencies must be finite and positive, and every impedance must be finite with **|Z| > 0**.
  Invalid points, invalid averages at duplicate frequencies, failed derivative calculations, and
  non-finite or zero reconstructed magnitudes reject that dataset with an explicit error.
- The two-decade requirement prevents the derivative window from collapsing on short ranges, where
  high derivatives can greatly amplify even 1% noise. It does not guarantee accuracy for every spectrum.
- The programmatic `Y.drt.zhit(ds, options)` interface accepts polynomial degrees 1–5 and a half-window
  `win` of at least 1 decade. A larger window requires a continuous span of at least `2 * win` decades.

**Gaps and output**

Masked points are included (masks apply only to circuit fits). Duplicate frequencies are averaged.
A spacing exceeding both four times the median log-frequency spacing and half a decade splits the
spectrum into separate ranges. Each eligible range is reconstructed and normalized independently.
Ranges with too few points or insufficient frequency span are explicitly listed as **NOT checked** in
the Log. If no range qualifies, no reconstructed dataset is created.

New `zh_…` datasets contain **only checked points**. Unchecked measurements are not copied into the
reconstruction; the original dataset remains available alongside it. The Log reports the number of
checked versus total distinct-frequency points, RMS deviation, maximum absolute deviation and its
frequency. The deviation is `measured |Z| / reconstructed |Z| - 1`; RMS and maximum use checked points only.
For code callers, unchecked entries in `zr`, `zi` and `dev` are NaN; `unchecked` and `skippedRanges`
identify the omitted points/ranges.

**Interpretation**

Z-HIT is an approximate consistency check, **not a pass/fail proof** of causality or stationarity.
Noise, interpolation, endpoint derivatives, and sharp resonances can produce deviations even for
valid data. A low-frequency discrepancy may suggest drift, but should not be attributed to drift
without considering these limitations. Independent normalization across gaps cannot test the relative
magnitude offset between disconnected ranges. A constant multiplicative impedance error is also
absorbed into C. The DRT algorithms in the same `js/core/drt.js` file are separate from this Z-HIT procedure.

---

## 11. Kramers–Kronig test

*Analysis → Kramers–Kronig test of selected datasets* (or `kk`) checks a spectrum with the linear Kramers–Kronig test
(Lin-KK) of Boukamp and of Schönleber et al.: a model that obeys the Kramers–Kronig relations by construction is fitted
to Zr and Zi, and whatever the data do that such a model cannot follow is left in the residuals.

$$Z_\text{KK}(\omega) = R_0 + j\omega L + \frac{1}{j\omega C} + \sum_{k=1}^{M} \frac{R_k}{1 + j\omega\tau_k}$$

* The M time constants are fixed, log-spaced from $1/\omega_\text{max}$ to $1/\omega_\text{min}$. $R_0$, the $R_k$, L and
  1/C enter linearly: they come from one weighted linear least-squares fit (weights 1/|Z|, Householder QR with column
  pivoting), without start values or iterations. Each term is causal, linear and stable whatever its sign, so
  $Z_\text{KK}$ obeys the Kramers–Kronig relations for any values; negative $R_k$ are allowed.
* L takes up lead inductance and relaxations faster than $\tau_1$; C takes up blocking (capacitive) behaviour and
  relaxations slower than $\tau_M$.
* **Number of RC elements**: the fit is made for M = 1 … min(50, N/2), N distinct frequencies, and the smallest M whose
  rms residual stays within 10 % (and 0.1 percentage point) of the best one is kept: the elbow where more elements stop
  improving the fit, the same rule as the λ suggestion of the DRT. `kk>>M` uses M elements instead (1 to N − 2).
* **Residuals**, relative to the measured modulus: $\Delta_\text{re} = (Z_r - Z_{r,\text{KK}})/\lvert Z\rvert$ and
  $\Delta_\text{im} = (Z_i - Z_{i,\text{KK}})/\lvert Z\rvert$.

**Output**

New `kk_…` datasets hold $Z_\text{KK}$ at the distinct measured frequencies, with the parameters of the original; they
are selected together with the originals, so every plot compares the two. The Log gives, for each dataset, M, the rms of
$\Delta_\text{re}$ and of $\Delta_\text{im}$, and the largest $\lvert Z - Z_\text{KK}\rvert/\lvert Z\rvert$ with its
frequency. Masked points are used (masks apply only to circuit fits) and duplicate frequencies are averaged; gaps in the
frequencies need no special treatment. A dataset needs at least 6 distinct frequencies, finite and positive, and a
finite, nonzero |Z|. Large selections are computed in slices, with the progress bar.

**Interpretation**

Residuals at the noise level, scattered around zero, mean the spectrum is consistent with a linear, causal and stable
system. Larger residuals, or residuals with a trend, often at low frequency where a sweep spends most of its time, point
to drift, non-linearity or instrument artefacts. Simulated spectra without noise give rms residuals of a few 0.01 % or
less. Like Z-HIT, this is a consistency check, **not a pass/fail proof**: many elements can follow part of a small
drift, and a spectrum cut off in the middle of a relaxation can leave larger residuals at its ends.

**For code callers**

`Y.kk.run(ds, options)` (`js/core/kk.js`) accepts `M` (fixed number of RC elements), `maxM` (50, the largest automatic
M), `cap` (true; false leaves out the series capacitance), `fit` (`'complex'`, the default; `'real'`: $R_0$ and the
$R_k$ from Zr alone, then L and C from what remains of Zi; `'imag'`: the $R_k$, L and C from Zi alone, then $R_0$ from
Zr; these are Boukamp's transform tests, where the part not fitted is predicted) and `c`, for Schönleber's criterion
instead of the elbow: M grows until $\mu = 1 - \sum_{R_k<0}\lvert R_k\rvert / \sum_{R_k\ge 0}\lvert R_k\rvert \le c$
(0.85 in the paper). The μ criterion can stop at a very small M, when the time constants fall between sharp relaxations
or when the spectrum needs negative $R_k$ (inductive loops, series C or L), which is why it is not the default. The
result holds `f`, `zr`, `zi`, `resRe`, `resIm`, `dev`, `rmsRe`, `rmsIm`, `rms`, `max`, `fmax`, `chi2ps` (Boukamp's
pseudo χ², $\sum(\Delta_\text{re}^2 + \Delta_\text{im}^2)$), `M`, `mu`, `tau`, `R`, `R0`, `L` and `C`.

B. A. Boukamp, *J. Electrochem. Soc.* **142** (1995) 1885; M. Schönleber, D. Klotz, E. Ivers-Tiffée,
*Electrochim. Acta* **131** (2014) 20.

---

## 12. Data operations

All act on the selected datasets (Data menu, or the command line).

| Operation | Effect |
|---|---|
| **Normalize** | None (as measured, Ω); correction factor k: $Z \times k$ (unit unchanged); electrode area A: $Z \times A$ (Ω·cm²); resistivity: $Z \times A / L$ (Ω·cm), L the thickness. A new choice replaces the previous one; *None* restores the measured values. Fitted parameters are converted at the same time (R and L multiplied, C and Q divided, n, α, β and τ unchanged), so the fit still matches. Units are shown everywhere; *Save data* writes a `#normalization` line that is read back. |
| **Negate Zi** | $Z_i \to -Z_i$ (files written with the opposite sign convention). |
| **Add random noise** | Uniform noise in ±x % of \|Z\| added to Zr and Zi, Zr only, Zi only, or to f (tests; x below 100 % for f, so that the frequencies stay positive). |
| **Spline to a log frequency grid** | New datasets: natural cubic spline of Zr and Zi versus log f, on n log-spaced frequencies. Masked points are used. |
| **Smooth (Savitzky–Golay)** | New datasets: least-squares polynomial of degree d on 2s + 1 neighbours (frequencies taken as log-spaced); windows are shifted at the ends instead of shrunk. Masked points are used. |
| **Average selected datasets** | New dataset: point-by-point mean, masked points included; all datasets must share the same frequencies. |
| **Simulate spectrum** | New dataset from the circuit and the current values (Settings → Simulation). |
| **Mask / Unmask / Delete points** | See [Masked points](#masked-points). |
| **Delete selected datasets** | After confirmation. |

Dataset list: click to select, Ctrl+click to add one, Shift+click for a range, Ctrl+A for all; Delete removes; F2
or double-click renames; drag to reorder. `select>>text` selects by name (regular expressions work).

---

## 13. Saving

| Item | Content |
|---|---|
| **Save parameters of selected** | Tab-separated: one line per dataset with R², χ²w, χ²red, and value and SE % of each parameter. |
| **Save data of selected…** | Measured and/or model Zr, Zi (and σ when present), one block per dataset, chosen separator; masked points included, marked in a `masked` column. **Contributions** (off by default) adds `partK_freq/Hz`, `partK_Zr`, `partK_Zi` for each part in series of the circuit (named on a `#contributions` line); values below 10⁻⁹ of the part's largest \|Z\| are written as 0. These columns are ignored when reading. Read back with *Auto*, the `Yappari_JS.xml` preset or *Table with column headers*; a file with the model values only reads back as data. |
| **Report of selected datasets** | HTML: statistics, parameters and six plots per dataset (Nyquist, Zr, Zi with residuals, \|Z\|, phase). Up to 30 datasets it opens in a new tab; otherwise it is downloaded. |
| **Save project** (Ctrl+S) | JSON: data, masks, labels, circuit, limits, shared flags, settings, parameters and statistics of every dataset, and the Log (its lines, without the *Restore before* buttons: from the opening of the page, or from the project opened last, which brings its own Log). *Open project* restores everything. |
| **Save PNG** | The current plot. |
| **Save DRT…** | See [Save DRT](#save-drt). |
| **Settings file** | *Settings → Save settings… / Load settings… / Reset settings*. |

Closing the page with datasets loaded asks for confirmation; data are not kept between sessions unless saved.

---

## 14. History, undo and the Log

Before every command or action that changes datasets, a **restore point** keeps the datasets (data, masks,
parameters, fit results, labels), the selection and the circuit. In the **Log** tab, the line of each such action
has a *Restore before* button that brings back that state; a restore can itself be restored or undone. `undo` (or
*Data → Undo the last command*) goes back one step at a time. Steps of the mouse wheel or the arrow keys on one
parameter that follow each other (less than 1.5 s apart) share one restore point and one line of the Log.

Restore points are incremental: the data of a dataset (f, Zr, Zi, masks, σ) are copied only when they differ from
the newest restore point that holds that dataset; otherwise that copy is shared. A fit or a parameter change therefore
costs a few kilobytes, and only actions that change data (noise, masks, deleted points, normalisation …) copy them.
Restore points live in memory, up to 256 MB (the oldest are dropped first; none is kept when the datasets alone take
more), and are lost when the page is closed: *Save project* keeps a state for good.

---

## 15. Settings reference

| Group | Setting | Default | Meaning |
|---|---|---|---|
| Fit | Method | TRDL | See [Methods](#methods) (also in the Fit tab). |
| | Weight of each point | 1/\|Z\| | See [Quantity minimised](#quantity-minimised) (also in the Fit tab). |
| | Maximum iterations | 2500 | Integer from 1 to 65535 (u16 > 0), synchronized with the Fit panel. |
| | Stop when χ² changes less than | 10⁻¹² | Relative change between two iterations. |
| Data files | Column separator | Detect automatically | 3-column files and saved data. |
| | Use measured standard deviations as weights | off | w = 1/σ² when the file has σ. |
| Simulation | Start, end frequency, points | 10⁻³ Hz, 10⁶ Hz, 128 | Log-spaced grid for *Simulate spectrum*; positive frequencies, 2 to 100 000 points. |
| Plots | Datasets drawn at most | 60 | Larger selections are thinned out for drawing. |
| | Same scale on both Nyquist axes | on | |
| | Square Nyquist plot | off | Square frame and saved image, also in the Nyquist toolbar. |
| | Residuals | Absolute | Or relative, % of \|Z\|. |
| | Phase unit | Degrees | Or radians. |
| Limits | Min, max, shared | per element | For the current circuit; *shared* is used by the global fit. |
| Start values | Value, min, max, fitted | per element | Used when an element is added; min below max, the value between them; stored in the browser; *Reset element values*. |

Settings read from a settings or project file, or kept by the browser, are checked the same way: a value of the wrong
type or outside its range (a non-positive frequency, more than 100 000 points, a DRT λ outside 10⁻¹² – 10³ or more than
100 000 Gold iterations, an unknown separator, theme or method) is ignored, and limits of the circuit that are not two
numbers with min below max fall back to those of the element. Spline: 3 to 100 000 frequencies; smoothing: 1 to 1000
points on each side, degree 0 to 10.

---

## 16. Command line

Type in the field at the bottom of the window, Enter to run, ↑/↓ for the history. Commands act on the selected
datasets. Numbers accept SI prefixes where a frequency is expected (`1k`, `2.5M`, `10m`).

| Command | Action |
|---|---|
| `rndz>>x`, `rndzr>>x`, `rndzi>>x` | Add uniform noise of x % of \|Z\| to Zr and Zi, Zr only, Zi only |
| `rndf>>x` | Noise on the frequencies (tests), x below 100 |
| `negate_zi` | Change the sign of Zi |
| `spline>>n` | New datasets on n log-spaced frequencies |
| `smooth>>s&d` | Savitzky–Golay, s points on each side, degree d |
| `average` | Mean of the selected datasets |
| `fit`, `globalfit` | Fit the selected datasets one by one, or together |
| `clone_all`, `clone_active` | Copy the parameters of the dataset shown in the Parameters panel to all, or to the selected datasets |
| `mask`, `unmask` | Mask the points inside the current plot view, or show them all again |
| `simulate` | New dataset from the circuit and the current parameters |
| `select>>text` | Select the datasets whose name contains text (regular expressions work) |
| `label>>f`, `unlabel` | Label the point nearest to f on the Nyquist plot; remove the labels |
| `contrib` | Show or hide the contributions |
| `drt`, `drt_save`, `drt_search` | Show the DRT; save it; search the regularisation |
| `zhit` | Z-HIT check |
| `kk`, `kk>>M` | Kramers–Kronig test (Lin-KK); M RC elements, chosen automatically when omitted |
| `demo` | Add 24 simulated spectra |
| `undo` | Go back one step (repeat to go further) |
| `help` | The list of commands (also the **?** button) |

---

## 17. Mouse and keyboard

| Where | Action |
|---|---|
| Anywhere | F9 fit selected (Individual or Global, as set in the Fit tab); Ctrl+S save project; drop files to read them |
| Plots | Drag to zoom, Shift-drag or right-drag to pan, wheel to zoom, double-click to autoscale; click a legend entry to hide or show it |
| Parameter value | Mouse wheel or ↑/↓ change the value; Shift for larger steps, Alt for smaller ones |
| Parameters tab | ← → right of the dataset name: previous or next dataset of the list (it becomes the selection) |
| Dataset list | Ctrl+A all, Shift+click range, Ctrl+click one more, Delete, F2 or double-click to rename, drag to reorder |
| Circuit drawing | Click to select, Delete to remove, Ctrl+Z to undo, Esc to deselect |
| Tabs | ←/→ move between tabs when a tab has the focus |
| Side panel edge | Drag to resize, ←/→ when focused, double-click to reset |
| Command line | Enter to run, ↑/↓ history |

---

## 18. Files of the program, tests

```
index.html            page layout
style.css             the whole look: page, plots, circuit drawing and report (light and dark)
js/core/namespace.js  global object Y; Y.defineCore keeps the source of DOM-free modules for the workers
js/core/elements.js   element library: parameters, start values, limits, Z(ω)
js/core/circuit.js    circuit code parser and printer, tree editing, compiler, vectorised evaluator
js/core/linalg.js     Cholesky solve and inverse
js/core/fit.js        weights, residuals, TRDL, LM (bounded / unbounded), Nelder–Mead, statistics
js/core/globalfit.js  global fit with shared and local parameters (block Levenberg–Marquardt)
js/core/dataops.js    noise, Zi sign, correction factor, log spline, Savitzky–Golay, average, view selection
js/core/drt.js        DRT (Tikhonov NNLS, Fisk, Gold, λ search, peaks) and Z-HIT
js/core/kk.js         Kramers–Kronig test (Lin-KK): linear least squares on a chain of RC elements
js/io/readers.js      3 columns, tables with headers, MFLI, ZView, VersaStudio, XML definitions, format detection
js/io/writers.js      data, parameters, project files, downloads
js/state.js           datasets, selection, circuit, parameters, settings, event bus
js/history.js         restore points, undo
js/workers.js         Web Worker pool built from a Blob (works from file://), main-thread fallback
js/ui/*.js            theme (reads style.css), plots (canvas 2D and 3D), schematic, Model tab, DRT tab, panels, dialogs, menus, report
js/app.js             start-up, tabs, side panel, fit bar
files/                example data files
config/definitions/   XML presets, index.json and schema documentation
script/               third-party libraries, none needed for now
tests/                node tests/run_core_tests.js runs all Node tests (core, readers, DRT, Z-HIT, the review
                      fixes, the files/ examples; sample files missing from files/ are skipped);
                      python tests/browser_test.py [out_dir] drives index.html in headless Chromium (Playwright)
                      and saves screenshots
```

No library and no build step: plain JavaScript, canvas plots, one page.

---

## 19. Differences from Yappari 5.1 (LabVIEW)

* Circuits of any depth instead of ten slots; readable parameter names instead of 4ZARR, 2MR1D …
* Standard errors for all methods; global fit with shared and local parameters; parallel batch fits.
* DRT with three methods and a λ search; Z-HIT; Kramers–Kronig test (Lin-KK); contributions of the parts in series; measured-error weights.
* JSON project files. Custom formats use a native XML schema with detection rules; Yappari 5.1 definitions are not read.
* Restore points for every action; no dependence on the Windows decimal separator; runs in any recent browser.

---

## 20. Citing

N. Dragoe, *Materials Lab* **2024**, 3, 230031, https://doi.org/10.54227/mlab.20230031

Documentation and the LabVIEW version: https://nitad54448.github.io/yappari-5-1/
