# XML definitions — Yappari JS

The application reads `index.json` whenever File → Custom format, xml opens, and once per session for File → Auto (and dropped files), which uses every preset that has a `<detect>` section. It displays the listed XML filenames alphabetically and fetches a definition when selected. Nothing is hardcoded in JavaScript. The paths are relative to the application, so repository subpaths on GitHub Pages work.

To add a preset:

1. Create or download an XML definition using the dialog.
2. Put it in `config/definitions/`.
3. Add its filename to `index.json` under `definitions` (valid JSON, no trailing comma).
4. Publish both files and reopen the dialog. No GitHub Actions are required.

Save definition downloads a file (XML version 3); it does not write to your hosted folder or modify the index. Unlisted files are ignored.

## Generic table schema (versions 1 to 3)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<impedanceFormat version="1">
  <description>Example magnitude and phase export</description>
  <table delimiter="tab" decimalSeparator="." commentPrefix="#" missingValues="NA;NaN;N/A"/>
  <datasets mode="repeatedHeader">
    <header match="startsWith">Measurement:</header>
    <label source="afterHeader" length="0"/>
    <endMarker>End measurement</endMarker>
    <skipLines afterHeader="1" beforeEnd="0" footerPolicy="keepNumeric"/>
  </datasets>
  <columns numbering="1" representation="polar">
    <frequency column="1" unit="kHz"/>
    <magnitude column="2" unit="ohm"/>
    <phase column="3" unit="deg"/>
  </columns>
  <invalidRows action="skipAndReport"/>
</impedanceFormat>
```

For Cartesian data, replace the columns section with:

```xml
<columns numbering="1" representation="cartesian">
  <frequency column="1" unit="Hz"/>
  <real column="2" unit="ohm"/>
  <imaginary column="3" unit="ohm" sign="Zi"/>
</columns>
```

Use `sign="-Zi"` when the input column contains the negative of the imaginary component. Real and imaginary units must match. Polar magnitude must be nonnegative. All data is converted to Hz and ohms, with the measured imaginary sign, before import.

| Setting | Accepted values / behavior |
|---|---|
| Root version | `1`, `2` or `3`; unknown versions are rejected. `<detect>` and the readers added in 3 need version 3 |
| Dataset mode | `single`, `repeatedHeader`, `blankLines`; default `single` when omitted in XML |
| Header match | `contains` (default), `startsWith`, `exact`; case-sensitive and line-based; spaces significant |
| Header | Required for repeatedHeader; ignored in other modes; preceding text is discarded |
| Label source | `afterHeader` (default), `index`; only meaningful in repeatedHeader mode |
| Label length | Nonnegative integer; 0 keeps the full label; index mode uses zero-based block numbers |
| End marker | Optional literal substring; excludes the marker and following lines until a new block begins |
| Skip lines | Nonnegative integers per block. afterHeader counts physical lines after the header, or from the block start in other modes. beforeEnd counts physical lines before the next header, end marker, or end of file, after trailing blank lines are removed |
| Footer policy | `keepNumeric` (default): retain the candidate footer if all its rows parse as data; `always`: always remove the count |
| Delimiter | `tab` (default), `space` (whitespace), `comma`, `semicolon`, `auto` |
| Decimal separator | `.`, `,`, `auto` (default: also accept decimal commas unless the delimiter is comma) |
| Comments | Optional whole-line prefix, checked after trimming leading whitespace |
| Missing values | Semicolon-separated, case-insensitive markers; defaults to `NA;NaN;N/A`; blank fields are always missing |
| Columns | Three distinct positive integer positions, numbered from 1; no 255 limit |
| Frequency unit | `Hz` (default), `kHz`, `MHz`, `rad/s` |
| Impedance unit | `ohm` (default), `kohm`, `Mohm`, `mohm` (case-sensitive) |
| Phase unit | `deg` (default), `rad` |
| Invalid rows | `skipAndReport` (default), `error`; blank/comment lines are ignored; nonpositive frequency is invalid |

Quoted fields and doubled quotes are supported with tab, comma and semicolon delimiters, including quoted decimal commas. Multiline quoted fields and thousands separators are not supported. Whitespace-delimited fields cannot contain quoted spaces. Automatic delimiter detection is heuristic; choose an explicit delimiter for unusual data.

The root and columns are required. Other elements may be omitted to use defaults. Representation is inferred from a magnitude element if not explicitly set. Unknown elements/attributes, duplicate elements and incompatible columns are rejected. DTDs are not accepted. Escape XML special characters (`&amp;`, `&lt;`, etc.). Use the dialog's preview to verify dataset boundaries and first-point values.

The generic table layout does not support column-name mapping, grouping by column values, metadata extraction, uncertainty/mask columns, or arbitrary formulas. Specialized layouts below handle their own fixed structures. These can be added in a later schema revision; they must not be inserted as unrecognized fields.

Only this native XML is read; the LabVIEW XML, INI and JSON definitions of Yappari 5.1 are rejected. XML parsing uses the browser DOMParser; the numerical readers are DOM-free.


## Specialized layouts (version 2 and 3)

These definitions select built-in readers for structures that are not generic three-column tables.
The dialog shows File layout and Description; generic table fields are hidden because they do not apply.
Yappari JS additionally shows **Impedance to load**.

```xml
<impedanceFormat version="2" reader="mfliCsv">
  <description>LabOne sweeper CSV</description>
</impedanceFormat>
```

Reader values:

- `mfliCsv`: MFLI/MFIA LabOne CSV, one row per quantity and chunk, including frequency/grid and realz/imagz or absz/phasez (radians). Preserves the existing reader's behavior, including header-table fallback. Incomplete exports without frequency and impedance cannot be read.
- `zview`: MFLI ZView text / ZView .z. Preserves the existing reader's block and column handling.
- `yappariJS`: Save data exports. Add `source="auto"`, `source="measured"` or `source="model"` on the root. Auto prefers measured per dataset, falling back to model only when measured headings are absent. Explicit choices require the selected pair in every dataset. All four Save data delimiters are supported.
- `gamryDTA` (v3): Gamry DTA, every `ZCURVE TABLE` section, columns found by heading.
- `biologicMPT` (v3): BioLogic EC-Lab ASCII `.mpt`, split by cycle number.
- `versaPar` (v3): VersaStudio `.par`, each `<Segment>` with impedance (or E and I) columns.
- `columnHeaders` (v3): any table whose headings name frequency and Zr/Zi or |Z|/phase (File → Table with column headers).
- `table` (default when reader is absent): the generic schema above.

```xml
<impedanceFormat version="2" reader="yappariJS" source="model">
  <description>Read calculated impedance from Save data</description>
</impedanceFormat>
```

Specialized layouts allow only the description and detect elements, not generic table/columns/datasets settings.
The Yappari JS reader restores names, normalization and masks, retains uncertainties for measured data,
and excludes DRT sections. Its heading-based selection handles optional sigma columns and model-only exports.

There are eight indexed presets, all version 3 with detection rules. Older app versions cannot read version 3.

For a double-clicked file:// index.html, use Load definition to select XML manually. Automatic index/XML
fetching requires HTTP(S). See the main README section on local versus server use.


## Detection rules (version 3)

`<detect>` makes a definition usable by File → Auto. It may appear in table and specialized definitions.

```xml
<impedanceFormat version="3">
  <description>SP2M Z-MFLI temperature series</description>
  <detect priority="50">
    <fileName>*.dat</fileName>
    <fileName>*.txt</fileName>
    <contains>Temp /K before measurement : </contains>
    <matches>(?i)^frequency /Hz</matches>
    <excludes>ZPLOT</excludes>
  </detect>
  ...
</impedanceFormat>
```

| Element | Meaning |
|---|---|
| `priority` | Integer, default 0. Matching definitions are tried from the highest priority; ties go to the one with more rules |
| `<fileName>` | Glob on the file name (`*`, `?`, case-insensitive). If any are given, one must match |
| `<contains>` | Literal text (spaces significant); every one must occur |
| `<matches>` | JavaScript regular expression, multiline (`^`/`$` per line); every one must match. Prefix `(?i)` to ignore case. Escape `<` as `&lt;` |
| `<excludes>` | Literal text that must not occur |

At least one `fileName`, `contains` or `matches` rule is required. Text rules look at the first 64 kB, with line
endings normalized to `\n`. If a matching definition fails to read the file, Auto reports it and tries the next
candidate, then the built-in recognisers. Use specific text rules: a definition with only a broad file-name rule
will be tried on every file with that extension. In the dialog, the Detect fields hold one rule per line; Preview
data reports whether the rules match the chosen file.

Bundled priorities: the SP2M tables use 50 (their header text is very specific), vendor layouts 20, ZView 10.
