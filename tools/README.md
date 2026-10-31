# Financial Projections (FP) data refresh

The "Financial Projections" tab shows the group financial model exactly as laid out in Excel.
It is **static**: everything it displays comes from one file, `src/data/fpData.json`,
which is generated from the Excel model by `tools/fp_export.py`.
Until that file is regenerated, the tab keeps showing the model version it was last built from
(the footer under the sheet list shows the version and date).

## When a new model version arrives (v7, v8 ...)

1. Save the new Excel file normally in Excel (so the calculated results are stored in it).
2. From the project root, run:

       pip install openpyxl lxml
       python tools/fp_export.py "path\to\Rays_Financial_Model_Group_v7_Nov2026.xlsx"

   The version and month are read from the file name. To set them yourself:

       python tools/fp_export.py "model.xlsx" --version v7 --date "12 Nov 2026"

3. Check the tab at http://localhost:5173 (Financial Projections), then commit
   `src/data/fpData.json` like any other change.

Sheets named TOC, Change Log and Title are left out on purpose (see `SKIP_SHEETS` in the script).
Every other sheet of the workbook is picked up automatically, in workbook order.
