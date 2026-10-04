# Yappari JS

*Yet Another Program for Analysis and Research in Impedance*, browser version of
[Yappari 5.1](https://nitad54448.github.io/yappari-5-1/) (LabVIEW) by Nita Dragoe, Université Paris-Saclay, ICMMO.
One equivalent circuit is fitted to one or to thousands of impedance spectra; the distribution of relaxation
times (DRT) and the Z-HIT check complete the analysis.

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
11. [Data operations](#11-data-operations)
12. [Saving](#12-saving)
13. [History, undo and the Log](#13-history-undo-and-the-log)
14. [Settings reference](#14-settings-reference)
15. [Command line](#15-command-line)
16. [Mouse and keyboard](#16-mouse-and-keyboard)
17. [Files of the program, tests](#17-files-of-the-program-tests)
18. [Differences from Yappari 5.1](#18-differences-from-yappari-51-labview)
19. [Citing](#19-citing)

---

## 1. Quick start

1. **Read data**: *File* menu → choose the format, or simply drop files on the window. To try the program,
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
| **Log** | Every action and message, with *Restore before* buttons (see [History](#13-history-undo-and-the-log)). |
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
| **File** | Read: 3 columns · MFLI csv · MFLI ZView .txt / ZView .z · VersaStudio .par · Table with column headers · Custom format. Open project · Save project. Save parameters of selected · Save data of selected · Report of selected datasets. Load 24 demo spectra. |
| **Data** | Undo the last command. Mask points in the current view · Unmask selected datasets · Delete points in the current view · Delete selected datasets. Normalize · Negate Zi. Add random noise · Spline to a log frequency grid · Smooth (Savitzky–Golay) · Average selected datasets. Simulate spectrum. |
| **Analysis** | Show / Save the DRT of selected datasets · DRT λ search. Z-HIT of selected datasets. Label a frequency on the Nyquist plot · Clear Nyquist labels. Command line help. |

Items that cannot run in the current situation are greyed out, and their tooltip says why: no data loaded, no dataset
selected, no circuit, no masked points to unmask, no labels to clear, nothing to undo, a fit running, and so on. The
*Fit*, *Copy these values to*, *Label frequency*, *Clear labels*, *Save PNG* and DRT buttons follow the same
rules. The command line and the keyboard shortcuts still run the commands, which then say in the status line why not.

**Side panel**

| Tab | Content |
|---|---|
| **Datasets** | All datasets, newest on top. Colour square = plot colour; dot on the right = fit status (green converged; amber iteration limit, stalled, singular system or all fitted parameters at their limits; red failed). Selected datasets are amber. |
| **Parameters** | Values of the first selected dataset: name, value, unit, standard error (%), fit tick box. Below: χ²w, χ²red, R², weights, fit status. At the bottom: *Copy these values to All datasets / Selected datasets*. |
| **Fit** | What will be fitted (number of selected datasets, circuit), mode **Individual** or **Global**, method, weights, max iterations, min χ² step (relative tolerance) and *Stop*. The **Fit** button is in the top bar, immediately left of Settings. All four fit settings stay synchronized with Settings. |

Drag the **left edge of the side panel** to resize it (arrow keys when it has the focus; double-click resets).
The **?** at the bottom left lists the commands of the command line. The progress bar appears in the status bar
only while a job runs.

---

## 3. Reading data

All formats are in *File*. Several files can be chosen at once; dropped files are recognised automatically.
Each spectrum becomes a **dataset** holding the frequency f (Hz), Zr and Zi (Ω, Zi negative for capacitive
behaviour).

* **3 columns**: f, Zr, Zi, one dataset per file. The separator is detected or set in *Settings → Data files*;
  decimal commas are accepted whenever the separator is not a comma.
* **Table with column headers**: any text table whose header names a frequency, a real and an imaginary column
  (`frequency, realz, imagz`, `freq/Hz, Re(Z)/Ohm, -Im(Z)/Ohm`, `Freq, Zreal, Zimag`, `Z'`, `-Z''` …): EC-Lab,
  Gamry and similar exports. A `chunk` column (Zurich Instruments LabOne) splits the sweeps into datasets; a
  `-Im` column is negated. Files written by *Save data* are read back this way, names, normalization and masked
  points included.
* **MFLI csv** (Zurich Instruments LabOne sweeper export, `;` or `,`): one line per field and sweep,
  `chunk;timestamp;size;fieldname;values…`. Each chunk is a dataset (`name_0`, `name_1` …); f comes from the
  `frequency` line (or `grid`), Z from `realz` and `imagz` (or `absz` and `phasez`, the phase in radians); points
  still `nan` are skipped. Standard deviations (`realzstddev`, `imagzstddev`, `abszstddev`) are kept for weighting.
* **MFLI ZView .txt and ZView .z**: f, Z′ and Z″ from columns 1, 5 and 6; each block of numbers is a dataset. A ZView
  file opened with *3 columns* is recognised and read the same way.
* **VersaStudio .par**: each `<Segment>` with frequency and impedance (or E and I) columns.
* **Custom format**: files holding several datasets, each starting with the same header text (examples:
  `files/Z_MFLI.txt`, `files/hp4192a.txt`). Definitions are the XML files of Yappari 5.1
  (`files/Z_MFLI_datafile_example_template.xml`, `files/custom_hp4192a.xml`); the dialog loads them, offers them
  as presets and saves new ones in the same XML, which the LabVIEW version reads too. Older `.ini` definitions and
  JSON are read as well. Fields:

  | Field | Meaning |
  |---|---|
  | Header | Text in front of every dataset; it can be part of a longer line. |
  | Label length | Characters after the header added to the dataset name; 0 numbers the datasets. |
  | Data separator | Space, comma, semicolon or TAB. |
  | Ignore first | Lines skipped after the header line. |
  | Frequency, Zr, Zi columns | Column numbers, counted from 1. |
  | Ignore last | Lines skipped at the end of each dataset; a dataset cut short keeps all its rows. |

* **Open project**: a `.json` project written by *Save project* (also opens when dropped).
* **Dropped files** are read automatically: ZView, VersaStudio, tables with headers, or blocks of three numbers
  separated by text lines (`hp4192a.txt` gives its three cycles). Drop a definition file together with data files
  to read them with it.

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
*Colour the parts in series* uses the colours of the contributions shown on the plots.

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
values of very different size are handled evenly; the solution is the same. n, α and β are varied in absolute
steps. Limits are set per parameter in *Settings → Parameter limits for the current circuit*; a value typed outside
them is brought back to the nearest limit.

### Running fits

* **Individual** mode: each selected dataset is fitted on its own, from its own start values, in parallel Web
  Workers (the status bar shows how many). *Stop* interrupts a running batch; a running global fit is stopped
  at once and its result discarded (parameters unchanged).
* A fit that stops on tiny steps is checked with one Gauss-Newton step; if χ² could still drop noticeably it is
  reported as *stalled, not a minimum* (amber), not as converged.
* Fit flags (the tick boxes) are per dataset and are copied with the values by *Copy these values to …*.
* Start values: type them, or turn the mouse wheel over a value (Shift: larger steps, Alt: smaller), or use the
  arrow keys. The model curve follows immediately.
* *Simulate spectrum* (Data menu) creates a dataset from the circuit and the current values over the frequency range
  set in *Settings → Simulation*.

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

**Fit tab → Global**, then *Global fit of selected*: one fit of all selected datasets with one circuit. Each fitted
parameter is

* **shared**: one value for all datasets (ticked *shared* in *Settings → Parameter limits*; the default, which is
  the LabVIEW behaviour), or
* **local**: one value per dataset (untick *shared*).

Shared parameters start from the first selected dataset, local ones from each dataset's own values. The fit is a
Levenberg–Marquardt on the block-arrow normal equations (Schur complement on the shared block), so hundreds of
datasets with local parameters stay cheap. χ²w is the sum over all datasets; χ²red uses $2\sum N - p_\text{total}$.
Bounds are applied by projection, except with method LM. Typical uses: a series of spectra at several temperatures
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
* **DRT, Z-HIT, average, spline and smooth** use masked points. Z-HIT still reports a real gap in the frequencies,
  for example after points are deleted.
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

* $R_\infty$ = Zr at the highest frequency, $R_\text{pol}$ = Zr at the lowest frequency − $R_\infty$, both from the
  data, as in Yappari 5.1.
* τ is log-spaced over $1/\omega_\text{max} … 1/\omega_\text{min}$ with the density of the data (at least 10 points
  per decade), so gaps in the frequencies leave no holes in g. Masked points are used.
* Discretised, the problem is $A\,g = y$, where y holds the chosen parts of $(Z - R_\infty)/R_\text{pol}$; dividing by
  $R_\text{pol}$ makes λ independent of the size of the impedance.

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
of Zi alone, compared with the measured Zr, for information). The suggested value is the strongest regularisation
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
is rebuilt from the phase φ and compared with the measured |Z|.

$$\ln\lvert Z(\omega_0)\rvert = C + \frac{2}{\pi}\int^{\omega_0}\varphi\,d\ln\omega - \frac{\pi}{6}\varphi' - \frac{\pi^3}{360}\varphi''' - \frac{\pi^5}{15120}\varphi^{(5)} - \frac{\pi^7}{604800}\varphi^{(7)}$$

(derivatives with respect to ln ω). The phase is resampled on a uniform ln ω grid (cubic spline, ≥ 10 points per
decade); derivatives come from local polynomials of degree 5 over ±1 decade, so $\varphi^{(7)}$ counts as 0: a
degree-7 fit turns 1 % noise into errors of hundreds of percent, while degree 5 keeps the deviation of valid noisy
data at the noise level. C matches the median of ln|Z|. New datasets `zh_…` hold the spectrum rebuilt from the
phase (rebuilt |Z|, measured phase); the rms and the largest deviation are written to the Log. Deviations larger
than the noise, especially at low frequency, indicate drift or non-stationary data.
Masked points are used. The phase integral cannot cross a gap in the frequencies (points deleted, for example), so
each side of such a gap is checked on its own (and the gap is reported).

---

## 11. Data operations

All act on the selected datasets (Data menu, or the command line).

| Operation | Effect |
|---|---|
| **Normalize** | None (as measured, Ω); correction factor k: $Z \times k$ (unit unchanged); electrode area A: $Z \times A$ (Ω·cm²); resistivity: $Z \times A / L$ (Ω·cm), L the thickness. A new choice replaces the previous one; *None* restores the measured values. Fitted parameters are converted at the same time (R and L multiplied, C and Q divided, n, α, β and τ unchanged), so the fit still matches. Units are shown everywhere; *Save data* writes a `#normalization` line that is read back. |
| **Negate Zi** | $Z_i \to -Z_i$ (files written with the opposite sign convention). |
| **Add random noise** | Uniform noise in ±x % of \|Z\| added to Zr and Zi, Zr only, Zi only, or to f (tests). |
| **Spline to a log frequency grid** | New datasets: natural cubic spline of Zr and Zi versus log f, on n log-spaced frequencies. Masked points are used. |
| **Smooth (Savitzky–Golay)** | New datasets: least-squares polynomial of degree d on 2s + 1 neighbours (frequencies taken as log-spaced); windows are shifted at the ends instead of shrunk. Masked points are used. |
| **Average selected datasets** | New dataset: point-by-point mean, masked points included; all datasets must share the same frequencies. |
| **Simulate spectrum** | New dataset from the circuit and the current values (Settings → Simulation). |
| **Mask / Unmask / Delete points** | See [Masked points](#masked-points). |
| **Delete selected datasets** | After confirmation. |

Dataset list: click to select, Ctrl+click to add one, Shift+click for a range, Ctrl+A for all; Delete removes; F2
or double-click renames; drag to reorder. `select>>text` selects by name (regular expressions work).

---

## 12. Saving

| Item | Content |
|---|---|
| **Save parameters of selected** | Tab-separated: one line per dataset with R², χ²w, χ²red, and value and SE % of each parameter. |
| **Save data of selected…** | Measured and/or model Zr, Zi (and σ when present), one block per dataset, chosen separator; masked points included, marked in a `masked` column. Read back with *Table with column headers*; a file with the model values only reads back as data. |
| **Report of selected datasets** | HTML: statistics, parameters and six plots per dataset (Nyquist, Zr, Zi with residuals, \|Z\|, phase). Up to 30 datasets it opens in a new tab; otherwise it is downloaded. |
| **Save project** (Ctrl+S) | JSON: data, masks, labels, circuit, limits, shared flags, settings, parameters and statistics of every dataset. *Open project* restores everything. |
| **Save PNG** | The current plot. |
| **Save DRT…** | See [Save DRT](#save-drt). |
| **Settings file** | *Settings → Save settings… / Load settings… / Reset settings*. |

Closing the page with datasets loaded asks for confirmation; data are not kept between sessions unless saved.

---

## 13. History, undo and the Log

Before every command or action that changes datasets, a **restore point** keeps the datasets (data, masks,
parameters, fit results, labels), the selection and the circuit. In the **Log** tab, the line of each such action
has a *Restore before* button that brings back that state; a restore can itself be restored or undone. `undo` (or
*Data → Undo the last command*) goes back one step at a time. Restore points live in memory, up to 256 MB (the
oldest are dropped first), and are lost when the page is closed: *Save project* keeps a state for good.

---

## 14. Settings reference

| Group | Setting | Default | Meaning |
|---|---|---|---|
| Fit | Method | TRDL | See [Methods](#methods) (also in the Fit tab). |
| | Weight of each point | 1/\|Z\| | See [Quantity minimised](#quantity-minimised) (also in the Fit tab). |
| | Maximum iterations | 2500 | Integer from 1 to 65535 (u16 > 0), synchronized with the Fit panel. |
| | Stop when χ² changes less than | 10⁻¹² | Relative change between two iterations. |
| Data files | Column separator | Detect automatically | 3-column files and saved data. |
| | Use measured standard deviations as weights | off | w = 1/σ² when the file has σ. |
| Simulation | Start, end frequency, points | 10⁻³ Hz, 10⁶ Hz, 128 | Log-spaced grid for *Simulate spectrum*. |
| Plots | Datasets drawn at most | 60 | Larger selections are thinned out for drawing. |
| | Same scale on both Nyquist axes | on | |
| | Square Nyquist plot | off | Square frame and saved image, also in the Nyquist toolbar. |
| | Residuals | Absolute | Or relative, % of \|Z\|. |
| | Phase unit | Degrees | Or radians. |
| Limits | Min, max, shared | per element | For the current circuit; *shared* is used by the global fit. |
| Start values | Value, min, max, fitted | per element | Used when an element is added; min below max, the value between them; stored in the browser; *Reset element values*. |

---

## 15. Command line

Type in the field at the bottom of the window, Enter to run, ↑/↓ for the history. Commands act on the selected
datasets. Numbers accept SI prefixes where a frequency is expected (`1k`, `2.5M`, `10m`).

| Command | Action |
|---|---|
| `rndz>>x`, `rndzr>>x`, `rndzi>>x` | Add uniform noise of x % of \|Z\| to Zr and Zi, Zr only, Zi only |
| `rndf>>x` | Noise on the frequencies (tests) |
| `negate_zi` | Change the sign of Zi |
| `spline>>n` | New datasets on n log-spaced frequencies |
| `smooth>>s&d` | Savitzky–Golay, s points on each side, degree d |
| `average` | Mean of the selected datasets |
| `fit`, `globalfit` | Fit the selected datasets one by one, or together |
| `clone_all`, `clone_active` | Copy the parameters of the first selected dataset to all, or to the selected datasets |
| `mask`, `unmask` | Mask the points inside the current plot view, or show them all again |
| `simulate` | New dataset from the circuit and the current parameters |
| `select>>text` | Select the datasets whose name contains text (regular expressions work) |
| `label>>f`, `unlabel` | Label the point nearest to f on the Nyquist plot; remove the labels |
| `contrib` | Show or hide the contributions |
| `drt`, `drt_save`, `drt_search` | Show the DRT; save it; search the regularisation |
| `zhit` | Z-HIT check |
| `demo` | Add 24 simulated spectra |
| `undo` | Go back one step (repeat to go further) |
| `help` | The list of commands (also the **?** button) |

---

## 16. Mouse and keyboard

| Where | Action |
|---|---|
| Anywhere | F9 fit selected (Individual or Global, as set in the Fit tab); Ctrl+S save project; drop files to read them |
| Plots | Drag to zoom, Shift-drag or right-drag to pan, wheel to zoom, double-click to autoscale; click a legend entry to hide or show it |
| Parameter value | Mouse wheel or ↑/↓ change the value; Shift for larger steps, Alt for smaller ones |
| Dataset list | Ctrl+A all, Shift+click range, Ctrl+click one more, Delete, F2 or double-click to rename, drag to reorder |
| Circuit drawing | Click to select, Delete to remove, Ctrl+Z to undo, Esc to deselect |
| Tabs | ←/→ move between tabs when a tab has the focus |
| Side panel edge | Drag to resize, ←/→ when focused, double-click to reset |
| Command line | Enter to run, ↑/↓ history |

---

## 17. Files of the program, tests

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
js/io/readers.js      3 columns, tables with headers, MFLI, ZView, VersaStudio, custom definitions
js/io/writers.js      data, parameters, project files, downloads
js/state.js           datasets, selection, circuit, parameters, settings, event bus
js/history.js         restore points, undo
js/workers.js         Web Worker pool built from a Blob (works from file://), main-thread fallback
js/ui/*.js            theme (reads style.css), plots (canvas 2D and 3D), schematic, Model tab, DRT tab, panels, dialogs, menus, report
js/app.js             start-up, tabs, side panel, fit bar
files/                example data files and custom-format definitions (Yappari 5.1 XML)
config/definitions/   custom-format definitions in JSON
script/               third-party libraries, none needed for now
tests/                node tests/run_core_tests.js runs all Node tests (core, readers, DRT, Z-HIT, the review
                      fixes, the files/ examples; sample files missing from files/ are skipped);
                      python tests/browser_test.py [out_dir] drives index.html in headless Chromium (Playwright)
                      and saves screenshots
```

No library and no build step: plain JavaScript, canvas plots, one page.

---

## 18. Differences from Yappari 5.1 (LabVIEW)

* Circuits of any depth instead of ten slots; readable parameter names instead of 4ZARR, 2MR1D …
* Standard errors for all methods; global fit with shared and local parameters; parallel batch fits.
* DRT with three methods and a λ search; Z-HIT; contributions of the parts in series; measured-error weights.
* JSON project files. Custom-format definitions stay the Yappari 5.1 XML files, read and written.
* Restore points for every action; no dependence on the Windows decimal separator; runs in any recent browser.

---

## 19. Citing

N. Dragoe, *Materials Lab* **2024**, 3, 230031, https://doi.org/10.54227/mlab.20230031

Documentation and the LabVIEW version: https://nitad54448.github.io/yappari-5-1/
