#!/usr/bin/env python3
"""
Financial Projections (FP) exporter
===================================
Converts the group financial-model Excel workbook into ONE static JSON file
(src/data/fpData.json) that the dashboard's "Financial Projections" tab renders
cell-for-cell: values exactly as Excel shows them (number formats applied),
fonts, fills, borders, merged cells, column widths, row heights, frozen panes,
conditional-format colours, cell notes, hyperlinks and the bar charts.

Usage (from the project root):
    python tools/fp_export.py "Rays_Financial_Model_Group_v7_Nov2026.xlsx"
    python tools/fp_export.py "model.xlsx" --version v7 --date "12 Nov 2026"

Needs:  pip install openpyxl lxml

The workbook must have been saved by Excel (or LibreOffice) so that formula
results are stored in the file - this script reads those stored values and
never recalculates anything.
"""
import argparse, colorsys, datetime, json, math, os, re, sys, zipfile
from decimal import Decimal, ROUND_HALF_UP

import openpyxl
from openpyxl.styles.colors import COLOR_INDEX
from openpyxl.utils import get_column_letter, column_index_from_string
from lxml import etree
from openpyxl.styles import Font, PatternFill, Alignment, Border

# Sheets that are NOT shown in the dashboard
SKIP_SHEETS = {"TOC", "Change Log", "Title"}

DEFAULT_FONT_PT = 11.0
PX_PER_PT = 4.0 / 3.0
MAX_DIGIT_PX = 7  # Calibri 11


# ───────────────────────────── colours ──────────────────────────────────────
def load_theme(path):
    """Theme colour list in Excel's index order (0=lt1,1=dk1,2=lt2,3=dk2,4-9 accents,10,11 links)."""
    with zipfile.ZipFile(path) as z:
        names = [n for n in z.namelist() if n.startswith("xl/theme/theme")]
        if not names:
            return ["FFFFFF", "000000", "EEECE1", "1F497D", "4F81BD", "C0504D", "9BBB59", "8064A2", "4BACC6", "F79646", "0000FF", "800080"]
        root = etree.fromstring(z.read(names[0]))
    ns = {"a": "http://schemas.openxmlformats.org/drawingml/2006/main"}
    scheme = root.find(".//a:clrScheme", ns)
    out = {}
    for el in scheme:
        tag = etree.QName(el).localname
        child = el[0]
        out[tag] = child.get("val") if etree.QName(child).localname == "srgbClr" else child.get("lastClr")
    order = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"]
    return [out.get(k, "000000") for k in order]


def apply_tint(hex6, tint):
    if not tint:
        return hex6
    r, g, b = (int(hex6[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    l = l * (1 + tint) if tint < 0 else l * (1 - tint) + tint
    r, g, b = colorsys.hls_to_rgb(h, max(0, min(1, l)), s)
    return "%02X%02X%02X" % (round(r * 255), round(g * 255), round(b * 255))


class Colors:
    def __init__(self, theme):
        self.theme = theme

    def resolve(self, color):
        """openpyxl Color -> '#RRGGBB' or None (None = automatic/none)."""
        if color is None:
            return None
        t = getattr(color, "type", None)
        try:
            if t == "rgb":
                v = color.rgb
                if isinstance(v, str) and re.fullmatch(r"[0-9A-Fa-f]{8}", v):
                    return "#" + v[2:].upper()
                if isinstance(v, str) and re.fullmatch(r"[0-9A-Fa-f]{6}", v):
                    return "#" + v.upper()
                return None
            if t == "theme":
                idx = color.theme
                base = self.theme[idx] if 0 <= idx < len(self.theme) else "000000"
                return "#" + apply_tint(base.upper(), color.tint or 0)
            if t == "indexed":
                i = color.indexed
                if i in (64, 65):  # system foreground / background
                    return None
                v = COLOR_INDEX[i] if 0 <= i < len(COLOR_INDEX) else None
                return "#" + v[2:].upper() if v else None
        except Exception:
            return None
        return None


# ───────────────────────────── number formats ───────────────────────────────
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
NAMED_COLORS = {"red": "#FF0000", "blue": "#0000FF", "green": "#00B050", "black": "#000000", "white": "#FFFFFF",
                "yellow": "#FFFF00", "magenta": "#FF00FF", "cyan": "#00FFFF"}


def split_sections(fmt):
    secs, cur, i, inq = [], "", 0, False
    while i < len(fmt):
        ch = fmt[i]
        if ch == "\\":
            cur += fmt[i:i + 2]; i += 2; continue
        if ch == '"':
            inq = not inq; cur += ch; i += 1; continue
        if ch == "[" and not inq:
            j = fmt.find("]", i)
            j = len(fmt) - 1 if j < 0 else j
            cur += fmt[i:j + 1]; i = j + 1; continue
        if ch == ";" and not inq:
            secs.append(cur); cur = ""; i += 1; continue
        cur += ch; i += 1
    secs.append(cur)
    return secs


DATE_RE = re.compile(r"(yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|AM/PM|am/pm|A/P)", re.I)


def tokenize(sec):
    """-> (tokens, color). tokens: ('lit',text) | ('num',pattern) | ('pct',) | ('date',code) | ('at',)"""
    toks, color, i, n = [], None, 0, len(sec)
    while i < n:
        ch = sec[i]
        if ch == '"':
            j = sec.find('"', i + 1); j = n if j < 0 else j
            toks.append(("lit", sec[i + 1:j])); i = j + 1
        elif ch == "\\":
            toks.append(("lit", sec[i + 1] if i + 1 < n else "")); i += 2
        elif ch == "_":
            toks.append(("lit", " ")); i += 2
        elif ch == "*":
            i += 2
        elif ch == "[":
            j = sec.find("]", i); j = n - 1 if j < 0 else j
            tag = sec[i + 1:j]; i = j + 1
            m = re.match(r"\$([^-]*)(-.*)?$", tag)
            if m:
                if m.group(1):
                    toks.append(("lit", m.group(1)))
            elif tag.lower() in NAMED_COLORS:
                color = NAMED_COLORS[tag.lower()]
        elif ch in "0#?.,":
            j = i
            while j < n and sec[j] in "0#?.,":
                j += 1
            toks.append(("num", sec[i:j])); i = j
        elif ch == "%":
            toks.append(("pct",)); i += 1
        elif ch == "@":
            toks.append(("at",)); i += 1
        else:
            m = DATE_RE.match(sec, i)
            if m:
                toks.append(("date", m.group(1))); i = m.end()
            else:
                toks.append(("lit", ch)); i += 1
    return toks, color


def fmt_number_pattern(absval, pattern, pct_count):
    ip, _, fp = pattern.partition(".")
    trail = len(ip) - len(ip.rstrip(","))
    ip = ip.rstrip(",")
    thousands = "," in ip
    ipd = ip.replace(",", "")
    fpd = fp.replace(",", "")
    dec = len(fpd)
    # Excel rounds on the 15 significant digits it stores, not on the full binary value
    v = absval if isinstance(absval, Decimal) else Decimal("%.15g" % absval)
    v = v * (Decimal(100) ** pct_count) / (Decimal(1000) ** trail)
    q = v.quantize(Decimal(1).scaleb(-dec), rounding=ROUND_HALF_UP)
    s = format(q, "f")
    int_s, _, frac_s = s.partition(".")
    if int_s == "0":
        int_s = ""
    # integer part
    out_digits = []
    digits = list(int_s)
    for ph in reversed(ipd):
        if digits:
            out_digits.append(digits.pop())
        elif ph == "0":
            out_digits.append("0")
        elif ph == "?":
            out_digits.append(" ")
    while digits:
        out_digits.append(digits.pop())
    int_out = "".join(reversed(out_digits))
    if thousands:
        core = int_out.strip()
        pad = int_out[: len(int_out) - len(int_out.lstrip())]
        if core.isdigit():
            core = f"{int(core):,}"
        int_out = pad + core
    # fraction part
    frac_out = ""
    if dec:
        chars = list(frac_s.ljust(dec, "0"))
        res = []
        for idx, ph in enumerate(fpd):
            res.append(chars[idx] if idx < len(chars) else "0")
        # trim trailing zeros for '#' placeholders, blank for '?'
        k = len(res)
        while k > 0 and res[k - 1] == "0" and fpd[k - 1] in "#?":
            res[k - 1] = "" if fpd[k - 1] == "#" else " "
            k -= 1
        frac_out = "".join(res)
        if frac_out.strip() == "" and "0" not in fpd:
            return int_out
        return int_out + "." + frac_out
    return int_out


def fmt_date(dt, toks):
    out = []
    has_ampm = any(t[0] == "date" and t[1].lower() in ("am/pm", "a/p") for t in toks)
    for t in toks:
        if t[0] == "lit":
            out.append(t[1])
        elif t[0] == "date":
            c = t[1].lower()
            if c == "yyyy": out.append("%04d" % dt.year)
            elif c == "yy": out.append("%02d" % (dt.year % 100))
            elif c == "mmmm": out.append(MONTHS[dt.month - 1])
            elif c == "mmm": out.append(MONTHS[dt.month - 1][:3])
            elif c == "mm": out.append("%02d" % dt.month)
            elif c == "m": out.append(str(dt.month))
            elif c == "dddd": out.append(DAYS[dt.weekday()])
            elif c == "ddd": out.append(DAYS[dt.weekday()][:3])
            elif c == "dd": out.append("%02d" % dt.day)
            elif c == "d": out.append(str(dt.day))
            elif c in ("hh", "h"):
                h = dt.hour % 12 or 12 if has_ampm else dt.hour
                out.append(("%02d" if c == "hh" else "%d") % h)
            elif c in ("ss", "s"):
                out.append(("%02d" if c == "ss" else "%d") % dt.second)
            elif c in ("am/pm", "a/p"):
                out.append("AM" if dt.hour < 12 else "PM")
        else:
            out.append("")
    return "".join(out)


def general_text(v):
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        if v == int(v) and abs(v) < 1e11:
            return str(int(v))
        s = "%.10g" % v
        if "e" in s:
            m, e = s.split("e")
            s = "%sE%s%02d" % (m, "-" if int(e) < 0 else "+", abs(int(e)))
        return s
    return str(v)


def format_value(v, fmt):
    """-> (display_text, colour_or_None)"""
    if v is None:
        return "", None
    if isinstance(v, str):
        return v, None
    if isinstance(v, bool):
        return ("TRUE" if v else "FALSE"), None
    if fmt in (None, "", "General"):
        if isinstance(v, (datetime.datetime, datetime.date)):
            return v.strftime("%d-%m-%Y"), None
        return general_text(v), None
    secs = split_sections(fmt)
    if isinstance(v, (datetime.datetime, datetime.date)):
        if isinstance(v, datetime.date) and not isinstance(v, datetime.datetime):
            v = datetime.datetime(v.year, v.month, v.day)
        toks, color = tokenize(secs[0])
        return fmt_date(v, toks), color
    if isinstance(v, datetime.time):
        return v.strftime("%H:%M:%S"), None
    x = float(v)
    if x < 0 and len(secs) >= 2:
        sec, neg_prefix = secs[1], ""
    elif x == 0 and len(secs) >= 3:
        sec, neg_prefix = secs[2], ""
    else:
        sec, neg_prefix = secs[0], ("-" if x < 0 else "")
    toks, color = tokenize(sec)
    pct = sum(1 for t in toks if t[0] == "pct")
    num_done, out = False, []
    for t in toks:
        if t[0] == "lit":
            out.append(t[1])
        elif t[0] == "pct":
            out.append("%")
        elif t[0] == "num":
            if num_done:
                continue
            num_done = True
            out.append(fmt_number_pattern(abs(x), t[1], pct))
        elif t[0] == "at":
            out.append(general_text(v))
        elif t[0] == "date":
            out.append(t[1])
    text = "".join(out)
    if not num_done:
        text = general_text(v) if not text.strip() else text
    return neg_prefix + text, color


# ───────────────────────────── mini formula evaluator (conditional formats) ─
class XlErr(Exception):
    pass


REF_RE = re.compile(r"(?:(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_\.]*))!)?(\$?)([A-Z]{1,3})(\$?)(\d+)")


class Evaluator:
    def __init__(self, wb):
        self.wb = wb

    def compile(self, formula, home_ws):
        """Translate an Excel CF formula into a python callable(row_off, col_off)->value."""
        f = formula.lstrip("=")
        # protect strings
        parts = re.split(r'("(?:[^"]|"")*")', f)
        py = []
        for k, p in enumerate(parts):
            if k % 2 == 1:
                py.append(repr(p[1:-1].replace('""', '"')))
                continue
            p = p.replace("<>", " != ")
            p = re.sub(r"(?<![<>!=])=(?!=)", " == ", p)

            def repl(m):
                sh = (m.group(1) or m.group(2) or home_ws.title).replace("''", "'")
                return "_r(%r,%d,%r,%d,%r,%d,_dr,_dc)" % (sh, 1 if m.group(3) else 0, m.group(4), 1 if m.group(5) else 0, m.group(6), 0)
            p = REF_RE.sub(repl, p)
            p = re.sub(r"\b(AND|OR|ISNUMBER|SEARCH|ROUND|ABS|NOT|IF)\(", lambda m: "_f_" + m.group(1) + "(", p)
            py.append(p)
        src = "".join(py)
        code = compile(src, "<cf>", "eval")

        def run(dr, dc):
            env = {"_r": self._ref, "_dr": dr, "_dc": dc,
                   "_f_AND": lambda *a: all(bool(x) for x in a), "_f_OR": lambda *a: any(bool(x) for x in a),
                   "_f_NOT": lambda a: not a, "_f_ABS": lambda a: abs(a),
                   "_f_IF": lambda c, a, b=False: a if c else b,
                   "_f_ISNUMBER": lambda a: isinstance(a, (int, float)) and not isinstance(a, bool),
                   "_f_SEARCH": self._search, "_f_ROUND": self._round}
            try:
                return eval(code, {"__builtins__": {}}, env)
            except (TypeError, XlErr, ZeroDivisionError):
                return False
        return run

    def _ref(self, sheet, ca, col, ra, row, _unused, dr, dc):
        c = column_index_from_string(col) + (0 if ca else dc)
        r = int(row) + (0 if ra else dr)
        if c < 1 or r < 1:
            raise XlErr()
        cell = self.wb[sheet]._cells.get((r, c))
        v = cell.value if cell is not None else None
        return "" if v is None else v

    @staticmethod
    def _search(find, within):
        i = str(within).lower().find(str(find).lower())
        if i < 0:
            raise XlErr()
        return i + 1

    @staticmethod
    def _round(x, n):
        if not isinstance(x, (int, float)):
            raise XlErr()
        return float(Decimal(repr(x)).quantize(Decimal(1).scaleb(-int(n)), rounding=ROUND_HALF_UP))


def parse_range(rng):
    """'A1:C5' / 'A1' -> (min_col, min_row, max_col, max_row)"""
    rng = rng.replace("$", "")
    if ":" in rng:
        a, b = rng.split(":")
    else:
        a = b = rng
    ma, mb = re.match(r"([A-Z]+)(\d+)", a), re.match(r"([A-Z]+)(\d+)", b)
    return (column_index_from_string(ma.group(1)), int(ma.group(2)), column_index_from_string(mb.group(1)), int(mb.group(2)))


def lerp_color(c1, c2, t):
    a = [int(c1[i:i + 2], 16) for i in (1, 3, 5)]
    b = [int(c2[i:i + 2], 16) for i in (1, 3, 5)]
    return "#%02X%02X%02X" % tuple(round(a[k] + (b[k] - a[k]) * t) for k in range(3))


def percentile_inc(sorted_vals, p):
    if not sorted_vals:
        return 0
    k = (len(sorted_vals) - 1) * p
    f, c = math.floor(k), math.ceil(k)
    return sorted_vals[int(k)] if f == c else sorted_vals[f] + (sorted_vals[c] - sorted_vals[f]) * (k - f)


def dxf_props(dxf, colors):
    """DifferentialStyle -> {'fc':..., 'b':..., 'bg':...}"""
    out = {}
    if dxf is None:
        return out
    if dxf.font is not None:
        c = colors.resolve(dxf.font.color)
        if c: out["fc"] = c
        if dxf.font.b: out["b"] = 1
    if dxf.fill is not None:
        bg = None
        if dxf.fill.bgColor is not None:
            bg = colors.resolve(dxf.fill.bgColor)
        if bg is None and dxf.fill.fgColor is not None:
            bg = colors.resolve(dxf.fill.fgColor)
        if bg: out["bg"] = bg
    return out


def build_cf_map(ws, wsv, wb_vals, colors, sheet_xml_x14, max_row, max_col):
    """-> {(row, col): {'fc','b','bg'}} computed from the stored (calculated) values."""
    ev = Evaluator(wb_vals)
    result = {}

    def val(r, c):
        cell = wsv._cells.get((r, c))
        return cell.value if cell is not None else None

    def clamp(ranges):
        out = []
        for (c1, r1, c2, r2) in ranges:
            if c1 > max_col or r1 > max_row:
                continue
            out.append((c1, r1, min(c2, max_col), min(r2, max_row)))
        return out

    def setprops(cell, props):
        cur = result.setdefault(cell, {})
        for k, v in props.items():
            cur.setdefault(k, v)  # first (highest-priority) rule wins per property

    rules = []
    for cf in ws.conditional_formatting:
        for rule in cf.rules:
            rules.append((rule.priority or 9999, [parse_range(str(r)) for r in str(cf.sqref).split()], rule, None))
    for pr, ranges, formula, props in sheet_xml_x14:
        rules.append((pr, ranges, None, (formula, props)))
    rules.sort(key=lambda t: t[0])

    for pr, ranges, rule, extra in rules:
        first = ranges[0]          # relative references are anchored to the top-left of the first range
        ranges = clamp(ranges)     # ignore the part of a range lying beyond the sheet's content (e.g. Q68:Q1048576)
        if not ranges:
            continue
        if rule is not None and rule.type == "colorScale":
            cs = rule.colorScale
            cols = [colors.resolve(c) or "#FFFFFF" for c in cs.color]
            cells = [(r, c) for (c1, r1, c2, r2) in ranges for r in range(r1, r2 + 1) for c in range(c1, c2 + 1)]
            nums = sorted(v for (r, c) in cells for v in [val(r, c)] if isinstance(v, (int, float)) and not isinstance(v, bool))
            if len(nums) < 2:
                continue
            lo, hi = nums[0], nums[-1]
            mid = percentile_inc(nums, 0.5) if len(cols) == 3 else None
            for (r, c) in cells:
                v = val(r, c)
                if not isinstance(v, (int, float)) or isinstance(v, bool):
                    continue
                if len(cols) == 3:
                    if v <= mid:
                        t = 0 if mid == lo else (v - lo) / (mid - lo)
                        col = lerp_color(cols[0], cols[1], max(0, min(1, t)))
                    else:
                        t = 1 if hi == mid else (v - mid) / (hi - mid)
                        col = lerp_color(cols[1], cols[2], max(0, min(1, t)))
                else:
                    t = 0 if hi == lo else (v - lo) / (hi - lo)
                    col = lerp_color(cols[0], cols[1], t)
                setprops((r, c), {"bg": col})
            continue

        if rule is not None:
            props = dxf_props(rule.dxf, colors)
            if not props:
                continue
            if rule.type == "cellIs":
                op = rule.operator
                f1 = ev.compile(rule.formula[0], ws) if rule.formula else None
                f2 = ev.compile(rule.formula[1], ws) if rule.formula and len(rule.formula) > 1 else None
                for (c1, r1, c2, r2) in ranges:
                    for r in range(r1, r2 + 1):
                        for c in range(c1, c2 + 1):
                            v = val(r, c)
                            if v is None and op not in ("equal",):
                                continue
                            if isinstance(v, str):
                                continue
                            v = 0 if v is None else v
                            a = f1(r - first[1], c - first[0]) if f1 else None
                            b = f2(r - first[1], c - first[0]) if f2 else None
                            try:
                                ok = {"lessThan": v < a, "lessThanOrEqual": v <= a, "greaterThan": v > a, "greaterThanOrEqual": v >= a,
                                      "equal": v == a, "notEqual": v != a, "between": a <= v <= b, "notBetween": not (a <= v <= b)}.get(op, False)
                            except TypeError:
                                ok = False
                            if ok:
                                setprops((r, c), props)
            elif rule.type == "expression" and rule.formula:
                fn = ev.compile(rule.formula[0], ws)
                for (c1, r1, c2, r2) in ranges:
                    for r in range(r1, r2 + 1):
                        for c in range(c1, c2 + 1):
                            if fn(r - first[1], c - first[0]):
                                setprops((r, c), props)
        else:
            formula, props = extra
            fn = ev.compile(formula, ws)
            for (c1, r1, c2, r2) in ranges:
                for r in range(r1, r2 + 1):
                    for c in range(c1, c2 + 1):
                        if fn(r - first[1], c - first[0]):
                            setprops((r, c), props)
    return result


def read_x14_rules(zf, sheet_path):
    """x14 (extension) conditional formats that openpyxl does not load."""
    out = []
    try:
        xml = zf.read(sheet_path).decode("utf8")
    except KeyError:
        return out
    for m in re.finditer(r"<x14:conditionalFormatting.*?</x14:conditionalFormatting>", xml, flags=re.S):
        blk = m.group(0)
        sq = re.search(r"<xm:sqref>(.*?)</xm:sqref>", blk)
        fo = re.search(r"<xm:f>(.*?)</xm:f>", blk)
        pr = re.search(r'priority="(\d+)"', blk)
        if not (sq and fo):
            continue
        formula = fo.group(1).replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
        props = {}
        fc = re.search(r"<font>.*?<color rgb=\"([0-9A-Fa-f]{8})\"", blk, flags=re.S)
        if fc: props["fc"] = "#" + fc.group(1)[2:].upper()
        if re.search(r"<font><b/>", blk): props["b"] = 1
        bg = re.search(r"<bgColor rgb=\"([0-9A-Fa-f]{8})\"", blk)
        if bg: props["bg"] = "#" + bg.group(1)[2:].upper()
        out.append((int(pr.group(1)) if pr else 9999, [parse_range(r) for r in sq.group(1).split()], formula, props))
    return out


# ───────────────────────────── sheet export ─────────────────────────────────
BORDER_PX = {"thin": 1, "hair": 1, "dotted": 1, "dashed": 1, "mediumDashed": 2, "dashDot": 1, "dashDotDot": 1,
             "slantDashDot": 1, "mediumDashDot": 2, "mediumDashDotDot": 2, "medium": 2, "thick": 3, "double": 3}
BORDER_RANK = {"hair": 1, "dotted": 1, "dashed": 1, "thin": 2, "dashDot": 2, "dashDotDot": 2, "mediumDashed": 3,
               "medium": 4, "mediumDashDot": 4, "mediumDashDotDot": 4, "slantDashDot": 3, "double": 5, "thick": 5}


def border_token(side, colors):
    if side is None or not side.style:
        return None
    col = colors.resolve(side.color) or "#000000"
    return "%s|%s" % (side.style, col)


def stronger(a, b):
    if a is None: return b
    if b is None: return a
    return a if BORDER_RANK.get(a.split("|")[0], 0) >= BORDER_RANK.get(b.split("|")[0], 0) else b


class StyleTable:
    def __init__(self):
        self.items, self.index = [], {}

    def get(self, d):
        key = json.dumps(d, sort_keys=True, separators=(",", ":"))
        if key not in self.index:
            self.index[key] = len(self.items)
            self.items.append(d)
        return self.index[key]


def tok_to_css(tok):
    """'style|#RRGGBB' -> 'px|#RRGGBB|kind' as used by the viewer."""
    s, col = tok.split("|")
    kind = "d" if s in ("dotted", "hair") else ("s" if s in ("dashed", "mediumDashed", "dashDot", "dashDotDot") else ("2" if s == "double" else ""))
    return "%d|%s|%s" % (BORDER_PX.get(s, 1), col, kind)


def col_px(width):
    return max(0, int(round(width * MAX_DIGIT_PX + 5))) if width else 0



def used_extent(ws, wsv):
    """(max_row, max_col) of the real content: cells holding a value or visible fill/border.
    Isolated stray cells far away from the main block (e.g. a lone letter typed in column XFC)
    are ignored so they cannot blow the sheet up to 16,000 columns. Returns also the strays."""
    cols, rows, pts = set(), set(), []
    for (r, c), cell in ws._cells.items():
        v = wsv._cells.get((r, c))
        has_val = (cell.value is not None) or (v is not None and v.value is not None)
        vis = False
        if not has_val and cell.has_style:
            b = cell.border
            vis = bool(cell.fill and cell.fill.fill_type) or any(x is not None and x.style for x in (b.top, b.bottom, b.left, b.right))
        if has_val or vis:
            pts.append((r, c, has_val))
    if not pts:
        return 1, 1, []
    def trim(axis, gap):
        vals = sorted({p[axis] for p in pts})
        keep = [vals[0]]
        for x in vals[1:]:
            if x - keep[-1] > gap:    # a long run of empty rows/cols before a lone cell = stray
                break
            keep.append(x)
        return keep[-1]
    mr, mc = trim(0, 500), trim(1, 30)
    # a row that carries its own format (e.g. a full-width coloured band) is content even if it holds no cell
    band_rows = [r for r, d in ws.row_dimensions.items() if d.has_style and (d.fill.fill_type or any(
        x is not None and x.style for x in (d.border.top, d.border.bottom)))]
    mr = max([mr] + [r for r in band_rows if r <= mr + 500])
    strays = [(r, c) for (r, c, hv) in pts if r > mr or c > mc]
    return mr, mc, strays

def export_sheet(ws, wsv, colors, stylet, cf_map, notes, links, charts_for_sheet):
    max_row, max_col, strays = used_extent(ws, wsv)
    for _ch in charts_for_sheet:      # the grid must reach the bottom/right edge of every chart
        max_row = max(max_row, _ch['_to']['row'] + 1)
        max_col = max(max_col, _ch['_to']['col'] + 1)
    if strays:
        print('    note: ignored %d stray cell(s) outside the content area on %r: %s' % (len(strays), ws.title, ', '.join('%s%d' % (get_column_letter(c), r) for r, c in strays[:5])))

    # column widths
    base = ws.sheet_format.defaultColWidth or ((ws.sheet_format.baseColWidth or 8) + 0.43)
    widths = {c: col_px(base) for c in range(1, max_col + 1)}
    hidden_cols = set()
    for key, dim in ws.column_dimensions.items():
        lo = dim.min or column_index_from_string(key)
        hi = min(dim.max or lo, max_col)
        for c in range(lo, hi + 1):
            if c > max_col:
                break
            if dim.hidden:
                hidden_cols.add(c)
            elif dim.width:
                widths[c] = col_px(dim.width)
    # row heights
    default_h = round((ws.sheet_format.defaultRowHeight or 15) * PX_PER_PT)
    heights, hidden_rows = {}, set()
    for r, dim in ws.row_dimensions.items():
        if r > max_row:
            continue
        if dim.hidden:
            hidden_rows.add(r)
        elif dim.height:
            heights[r] = round(dim.height * PX_PER_PT)

    vis_cols = [c for c in range(1, max_col + 1) if c not in hidden_cols]
    vis_rows = [r for r in range(1, max_row + 1) if r not in hidden_rows]
    cmap = {c: i + 1 for i, c in enumerate(vis_cols)}
    rmap = {r: i + 1 for i, r in enumerate(vis_rows)}

    # Excel formats a position from, in this order: the cell itself (if the file holds one), the row's own
    # format, the column's own format. Title bands are usually a ROW format, so cells that are not stored
    # individually must inherit it - otherwise white title text lands on a white background.
    class _Blank:
        font, fill, alignment, border, number_format = Font(), PatternFill(), Alignment(), Border(), "General"
    BLANK = _Blank()
    col_dim_for = {}
    for key, dim in ws.column_dimensions.items():
        if dim.has_style:
            lo = dim.min or column_index_from_string(key)
            for c in range(lo, min(dim.max or lo, max_col) + 1):
                col_dim_for[c] = dim

    # only cells that are really stored in the file count as "a cell of its own" - openpyxl quietly creates
    # blank cells whenever something reads ws.cell(r, c), and those must not hide the row/column format
    stored = getattr(ws, "_fp_stored", None)

    def style_src(r, c):
        cell = ws._cells.get((r, c))
        if cell is not None and (stored is None or (r, c) in stored):
            return cell
        if r in ws.row_dimensions and ws.row_dimensions[r].has_style:
            return ws.row_dimensions[r]
        return col_dim_for.get(c, BLANK)

    # merges
    merges, merge_anchor, covered = [], {}, set()
    for rng in ws.merged_cells.ranges:
        c1, r1, c2, r2 = rng.min_col, rng.min_row, rng.max_col, rng.max_row
        cols_in = [c for c in range(c1, c2 + 1) if c in cmap]
        rows_in = [r for r in range(r1, r2 + 1) if r in rmap]
        if not cols_in or not rows_in:
            continue
        # anchor = first visible cell of the merge
        ar, ac = rows_in[0], cols_in[0]
        merge_anchor[(ar, ac)] = (len(rows_in), len(cols_in), (r1, c1, r2, c2))
        for r in rows_in:
            for c in cols_in:
                if (r, c) != (ar, ac):
                    covered.add((r, c))

    # borders: pre-pass collecting each cell's tokens
    def side_tokens(r, c):
        cell = style_src(r, c)
        b = cell.border
        return (border_token(b.top, colors), border_token(b.right, colors), border_token(b.bottom, colors), border_token(b.left, colors))

    cells_out = {}
    for r in vis_rows:
        for c in vis_cols:
            if (r, c) in covered:
                continue
            cell = style_src(r, c)
            _vc = wsv._cells.get((r, c))
            val = _vc.value if _vc is not None else None
            span = merge_anchor.get((r, c))
            r_end = span[2][2] if span else r
            c_end = span[2][3] if span else c
            # style
            font, fill, al = cell.font, cell.fill, cell.alignment
            fc = colors.resolve(font.color) if font and font.color is not None else None
            bg = None
            if fill is not None and fill.fill_type == "solid":
                bg = colors.resolve(fill.fgColor)
            text, numcolor = format_value(val, cell.number_format)
            if numcolor:
                fc = numcolor
            props = cf_map.get((r, c), {})
            if "fc" in props: fc = props["fc"]
            if "bg" in props: bg = props["bg"]
            bold = bool(font.b) or bool(props.get("b"))

            h = al.horizontal if al else None
            if h in (None, "general"):
                if isinstance(val, (int, float, datetime.datetime, datetime.date)) and not isinstance(val, bool):
                    h = "right"
                elif isinstance(val, bool):
                    h = "center"
                else:
                    h = "left"
            h = {"left": "l", "right": "r", "center": "c", "centerContinuous": "c", "justify": "l", "fill": "l", "distributed": "c"}.get(h, "l")
            v = {"top": "t", "center": "m", "bottom": "b", "justify": "t", "distributed": "m"}.get(al.vertical if al else None, "b")

            sty = {}
            if bold: sty["b"] = 1
            if font.i: sty["i"] = 1
            if font.u: sty["u"] = 1
            if font.strike: sty["st"] = 1
            if font.sz and abs(font.sz - DEFAULT_FONT_PT) > 0.01: sty["sz"] = font.sz
            if fc and fc != "#000000": sty["fc"] = fc
            if bg and bg != "#FFFFFF": sty["bg"] = bg
            if h != "l": sty["h"] = h
            if v != "b": sty["v"] = v
            if al and al.wrap_text: sty["w"] = 1
            if al and al.indent: sty["in"] = int(al.indent)
            if font.name and font.name not in ("Calibri",): sty["fn"] = font.name
            if al and al.textRotation: sty["rot"] = al.textRotation

            # borders - merged ranges take the outer edges of the whole range
            if span:
                R1, C1, R2, C2 = span[2]
                top = side_tokens(R1, C1)[0]
                left = side_tokens(R1, C1)[3]
                right = side_tokens(R1, C2)[1]
                bottom = side_tokens(R2, C1)[2]
                # also consider other cells along the edges
                for cc in range(C1, C2 + 1):
                    top = stronger(top, side_tokens(R1, cc)[0]); bottom = stronger(bottom, side_tokens(R2, cc)[2])
                for rr in range(R1, R2 + 1):
                    left = stronger(left, side_tokens(rr, C1)[3]); right = stronger(right, side_tokens(rr, C2)[1])
                tb = (top, right, bottom, left)
            else:
                tb = side_tokens(r, c)
            cells_out[(r, c)] = {"val": val, "text": text, "sty": sty, "bt": tb, "span": span, "rr": r_end, "cc": c_end}

    # normalise borders so each shared edge is drawn once (owner = right / bottom cell edge)
    def edge_h(r, c):  # between row r-1 and r at column c  (top of (r,c))
        up = cells_out.get((r - 1, c)); down = cells_out.get((r, c))
        a = up["bt"][2] if up else None
        b = down["bt"][0] if down else None
        return stronger(a, b)

    def edge_v(r, c):  # between col c-1 and c at row r (left of (r,c))
        lf = cells_out.get((r, c - 1)); rt = cells_out.get((r, c))
        a = lf["bt"][1] if lf else None
        b = rt["bt"][3] if rt else None
        return stronger(a, b)

    vis_row_set, vis_col_set = set(vis_rows), set(vis_cols)

    def next_vis_row(r):
        k = r + 1
        while k <= max_row and k not in vis_row_set: k += 1
        return k

    def next_vis_col(c):
        k = c + 1
        while k <= max_col and k not in vis_col_set: k += 1
        return k

    # covered cells need to be "seen" by neighbours for edge purposes: map covered -> anchor cell data
    for (r, c) in list(covered):
        pass

    out_rows = {}
    for (r, c), d in sorted(cells_out.items()):
        span = d["span"]
        R_end = d["rr"] if not span else span[2][2]
        C_end = d["cc"] if not span else span[2][3]
        # last visible row/col of this cell's extent
        last_r = max([x for x in range(r, R_end + 1) if x in vis_row_set] or [r])
        last_c = max([x for x in range(c, C_end + 1) if x in vis_col_set] or [c])
        top_b = edge_h(r, c) if r == vis_rows[0] else None
        left_b = edge_v(r, c) if c == vis_cols[0] else None
        # bottom: strongest of the horizontal edges under every column the cell covers
        bottom_b = None
        nr = next_vis_row(last_r)
        for cc in [x for x in range(c, last_c + 1) if x in vis_col_set]:
            bottom_b = stronger(bottom_b, edge_h(nr, cc))
        if nr > max_row:
            bottom_b = stronger(bottom_b, d["bt"][2])
        right_b = None
        nc = next_vis_col(last_c)
        for rr in [x for x in range(r, last_r + 1) if x in vis_row_set]:
            right_b = stronger(right_b, edge_v(rr, nc))
        if nc > max_col:
            right_b = stronger(right_b, d["bt"][1])
        sty = dict(d["sty"])
        for key, tok in (("bt", top_b), ("br", right_b), ("bb", bottom_b), ("bl", left_b)):
            if tok:
                sty[key] = tok_to_css(tok)
        has_visible = d["text"] != "" or "bg" in sty or any(k in sty for k in ("bt", "br", "bb", "bl"))
        if not has_visible:
            continue
        item = [cmap[c], d["text"], stylet.get(sty)]
        extra = {}
        if span:
            if span[0] > 1 or span[1] > 1:
                extra["m"] = [span[0], span[1]]
        key = "%d%s" % (r, get_column_letter(c))
        ra = "%s%d" % (get_column_letter(c), r)
        if ra in notes:
            extra["n"] = notes[ra]
        if ra in links:
            extra["l"] = links[ra]
        if extra:
            item.append(extra)
        out_rows.setdefault(rmap[r], []).append(item)

    # text overflow into empty neighbours (left-aligned, not wrapped, not merged)
    for rr, items in out_rows.items():
        by_col = {it[0]: it for it in items}
        for it in items:
            sty = stylet.items[it[2]]
            if not it[1] or sty.get("w") or sty.get("h", "l") != "l" or (len(it) > 3 and "m" in it[3]):
                continue
            cidx = it[0]
            width = widths[vis_cols[cidx - 1]]
            k = cidx + 1
            while k <= len(vis_cols) and not (k in by_col and by_col[k][1]) :
                width += widths[vis_cols[k - 1]]
                k += 1
            if k > len(vis_cols):
                width += 2400      # empty all the way to the sheet edge: Excel lets the text run on
            if width > widths[vis_cols[cidx - 1]]:
                if len(it) == 3:
                    it.append({})
                it[3]["ov"] = width

    # rows whose own format paints the whole row (title bands, section bands, rule lines): the viewer
    # carries that band on to the right-hand edge of the screen, as Excel does
    row_fill = {}
    for r in vis_rows:
        if r in ws.row_dimensions and ws.row_dimensions[r].has_style:
            rd = ws.row_dimensions[r]
            band = {}
            bg = colors.resolve(rd.fill.fgColor) if rd.fill and rd.fill.fill_type == "solid" else None
            if bg and bg != "#FFFFFF":
                band["bg"] = bg
            t_tok, b_tok = border_token(rd.border.top, colors), border_token(rd.border.bottom, colors)
            if t_tok: band["bt"] = tok_to_css(t_tok)
            if b_tok: band["bb"] = tok_to_css(b_tok)
            if band:
                row_fill[str(rmap[r])] = stylet.get(band)

    freeze = [0, 0]
    if ws.freeze_panes:
        m = re.match(r"([A-Z]+)(\d+)", ws.freeze_panes)
        fc_idx, fr_idx = column_index_from_string(m.group(1)) - 1, int(m.group(2)) - 1
        freeze = [sum(1 for r in vis_rows if r <= fr_idx), sum(1 for c in vis_cols if c <= fc_idx)]

    zoom = ws.sheet_view.zoomScale or 100
    sheet = {
        "name": ws.title,
        "rows": len(vis_rows), "cols": len(vis_cols),
        "colW": [widths[c] for c in vis_cols],
        "rowH": {str(rmap[r]): h for r, h in heights.items() if r in rmap},
        "defH": default_h,
        "freeze": freeze,
        "zoom": zoom,
        "grid": bool(ws.sheet_view.showGridLines) if ws.sheet_view.showGridLines is not None else True,
        "cells": {str(k): v for k, v in sorted(out_rows.items())},
    }
    if row_fill:
        sheet["rowFill"] = row_fill
    # charts
    ch_out = []
    for ch in charts_for_sheet:
        ch = dict(ch)
        fr, to = ch.pop("_from"), ch.pop("_to")
        # position inside the first visible cell at/after the anchor
        ar = next((r for r in range(fr["row"] + 1, max_row + 1) if r in rmap), None)
        ac = next((c for c in range(fr["col"] + 1, max_col + 1) if c in cmap), None)
        if ar is None or ac is None:
            continue
        w = sum(widths.get(c, 0) for c in range(fr["col"] + 1, to["col"] + 1) if c not in hidden_cols) + (to["colOff"] - fr["colOff"]) / 9525
        h = sum(heights.get(r, default_h) for r in range(fr["row"] + 1, to["row"] + 1) if r not in hidden_rows) + (to["rowOff"] - fr["rowOff"]) / 9525
        ch.update({"r": rmap[ar], "c": cmap[ac], "dx": round(fr["colOff"] / 9525), "dy": round(fr["rowOff"] / 9525),
                   "w": round(w), "h": round(h)})
        ch_out.append(ch)
    if ch_out:
        sheet["charts"] = ch_out
    return sheet


# ───────────────────────────── charts ───────────────────────────────────────
NS = {"c": "http://schemas.openxmlformats.org/drawingml/2006/chart", "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
      "xdr": "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}


def ref_values(wbv, ref):
    """'Sheet!$A$1:$B$2' or '(Sheet!$M$1,Sheet!$R$1)' -> [values]"""
    ref = ref.strip()
    if ref.startswith("(") and ref.endswith(")"):
        ref = ref[1:-1]
    vals = []
    for part in re.split(r",(?=(?:[^']*'[^']*')*[^']*$)", ref):
        m = re.match(r"(?:'((?:[^']|'')+)'|([^!]+))!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?", part.strip())
        if not m:
            continue
        sh = (m.group(1) or m.group(2)).replace("''", "'")
        ws = wbv[sh]
        c1, r1 = column_index_from_string(m.group(3)), int(m.group(4))
        c2 = column_index_from_string(m.group(5)) if m.group(5) else c1
        r2 = int(m.group(6)) if m.group(6) else r1
        for r in range(r1, r2 + 1):
            for c in range(c1, c2 + 1):
                cell = ws._cells.get((r, c))
                vals.append(cell.value if cell is not None else None)
    return vals


def nice_axis(values_by_cat, grouping, numfmt):
    """Excel-like automatic value axis: returns (vmin, vmax, [(tick, label), ...])."""
    lows, highs = [0.0], [0.0]
    if grouping in ("stacked", "percentStacked"):
        for col in values_by_cat:
            highs.append(sum(v for v in col if v > 0)); lows.append(sum(v for v in col if v < 0))
    else:
        for col in values_by_cat:
            for v in col:
                highs.append(v); lows.append(v)
    lo, hi = min(lows), max(highs)
    if hi == lo:
        hi = lo + 1
    span = hi - lo
    hi_p = hi + 0.05 * span if hi > 0 else hi
    lo_p = lo - 0.05 * span if lo < 0 else lo
    raw = (hi_p - lo_p) / 6.0
    mag = 10 ** math.floor(math.log10(raw))
    step = next(m * mag for m in (1, 2, 2.5, 5, 10) if m * mag >= raw)
    vmin, vmax = math.floor(lo_p / step + 1e-9) * step, math.ceil(hi_p / step - 1e-9) * step
    n = int(round((vmax - vmin) / step))
    ticks = []
    for i in range(n + 1):
        t = round(vmin + i * step, 10)
        ticks.append([t, format_value(t, numfmt)[0].strip()])
    return vmin, vmax, ticks


def sheet_chart_specs(zf, sheet_path, wbv, colors):
    """Return list of chart specs on the sheet at sheet_path (xl/worksheets/sheetN.xml)."""
    rels_path = sheet_path.replace("worksheets/", "worksheets/_rels/") + ".rels"
    if rels_path not in zf.namelist():
        return []
    rels = etree.fromstring(zf.read(rels_path))
    drawing = None
    for rel in rels:
        if rel.get("Type", "").endswith("/drawing"):
            drawing = os.path.normpath(os.path.join(os.path.dirname(sheet_path), rel.get("Target"))).replace("\\", "/")
    if not drawing:
        return []
    droot = etree.fromstring(zf.read(drawing))
    drels = etree.fromstring(zf.read(drawing.replace("drawings/", "drawings/_rels/") + ".rels"))
    rid2t = {r.get("Id"): os.path.normpath(os.path.join(os.path.dirname(drawing), r.get("Target"))).replace("\\", "/") for r in drels}
    specs = []
    for anchor in droot:
        fr, to = anchor.find("xdr:from", NS), anchor.find("xdr:to", NS)
        gf = anchor.find(".//c:chart", NS)
        if fr is None or to is None or gf is None:
            continue

        def pos(el):
            g = lambda t: int(el.find("xdr:" + t, NS).text)
            return {"col": g("col"), "colOff": g("colOff"), "row": g("row"), "rowOff": g("rowOff")}
        cx = etree.fromstring(zf.read(rid2t[gf.get("{%s}id" % NS["r"])]))
        title = "".join(t.text or "" for t in cx.findall(".//c:chart/c:title//a:t", NS))
        title_sz = None
        t_el = cx.find(".//c:chart/c:title//a:defRPr", NS)
        if t_el is not None and t_el.get("sz"):
            title_sz = int(t_el.get("sz")) / 100.0
        bar = cx.find(".//c:barChart", NS)
        if bar is None:
            continue
        spec = {"_from": pos(fr), "_to": pos(to), "title": title, "titlePt": title_sz,
                "dir": bar.find("c:barDir", NS).get("val"), "grouping": bar.find("c:grouping", NS).get("val"),
                "series": []}
        gap = bar.find("c:gapWidth", NS)
        spec["gap"] = int(gap.get("val")) if gap is not None else 150
        val_ax = cx.find(".//c:valAx", NS)
        nf = val_ax.find("c:numFmt", NS) if val_ax is not None else None
        spec["numFmt"] = nf.get("formatCode") if nf is not None else "General"
        spec["legend"] = cx.find(".//c:legend", NS) is not None
        _lp = cx.find(".//c:legend/c:legendPos", NS)
        spec["legendPos"] = _lp.get("val") if _lp is not None else "b"
        spec["grid"] = val_ax is not None and val_ax.find("c:majorGridlines", NS) is not None
        cats = None
        for ser in bar.findall("c:ser", NS):
            name_el = ser.find("c:tx", NS)
            name = ""
            if name_el is not None:
                v = name_el.find("c:v", NS)
                if v is not None:
                    name = v.text or ""
                else:
                    f = name_el.find(".//c:f", NS)
                    name = str(ref_values(wbv, f.text)[0]) if f is not None else ""
            clr = ser.find("c:spPr/a:solidFill/a:srgbClr", NS)
            color = "#" + clr.get("val") if clr is not None else None
            cat_f = ser.find("c:cat//c:f", NS)
            if cat_f is not None and cats is None:
                cats = [("" if v is None else (v.strftime("%b-%y") if isinstance(v, datetime.datetime) else str(v))) for v in ref_values(wbv, cat_f.text)]
            val_f = ser.find("c:val//c:f", NS)
            vals = [(v if isinstance(v, (int, float)) and not isinstance(v, bool) else 0) for v in ref_values(wbv, val_f.text)]
            spec["series"].append({"name": name, "color": color, "vals": vals})
        spec["cats"] = cats or ["" for _ in (spec["series"][0]["vals"] if spec["series"] else [])]
        cat_or = cx.find(".//c:catAx/c:scaling/c:orientation", NS)
        spec["catRev"] = cat_or is not None and cat_or.get("val") == "maxMin"
        n_cat = max((len(se["vals"]) for se in spec["series"]), default=0)
        by_cat = [[(se["vals"][i] if i < len(se["vals"]) else 0) for se in spec["series"]] for i in range(n_cat)]
        spec["vmin"], spec["vmax"], spec["ticks"] = nice_axis(by_cat, spec["grouping"], spec["numFmt"])
        specs.append(spec)
    return specs


# ───────────────────────────── main ─────────────────────────────────────────
def sheet_paths(zf):
    wbx = zf.read("xl/workbook.xml").decode("utf8")
    rels = zf.read("xl/_rels/workbook.xml.rels").decode("utf8")
    rid2t = {}
    for m in re.finditer(r"<Relationship [^>]*>", rels):
        s = m.group(0)
        rid2t[re.search(r'Id="([^"]+)"', s).group(1)] = re.search(r'Target="([^"]+)"', s).group(1)
    out = {}
    for m in re.finditer(r"<sheet [^>]*>", wbx):
        s = m.group(0)
        name = re.search(r'name="([^"]*)"', s).group(1).replace("&amp;", "&").replace("&apos;", "'").replace("&quot;", '"')
        rid = re.search(r'r:id="([^"]+)"', s).group(1)
        t = rid2t[rid]
        out[name] = t.lstrip("/") if t.startswith("/") else "xl/" + t
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("xlsx")
    ap.add_argument("--out", default=os.path.join("src", "data", "fpData.json"))
    ap.add_argument("--version", default=None, help="label such as v6 (default: taken from the file name)")
    ap.add_argument("--date", default=None, help='label such as "28 Oct 2026"')
    args = ap.parse_args()

    wb = openpyxl.load_workbook(args.xlsx, data_only=False)
    wbv = openpyxl.load_workbook(args.xlsx, data_only=True)
    for _ws in wb.worksheets:                       # remember which cells the file really holds
        _ws._fp_stored = set(_ws._cells.keys())
    theme = load_theme(args.xlsx)
    colors = Colors(theme)
    stylet = StyleTable()
    zf = zipfile.ZipFile(args.xlsx)
    paths = sheet_paths(zf)

    base = os.path.basename(args.xlsx)
    version = args.version or (re.search(r"[vV](\d+)", base).group(0).lower() if re.search(r"[vV](\d+)", base) else "")
    date_label = args.date
    if not date_label:
        m = re.search(r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[_\- ]?(20\d\d)", base)
        date_label = "%s %s" % (m.group(1), m.group(2)) if m else ""

    sheets = []
    for ws in wb.worksheets:
        if ws.title in SKIP_SHEETS:
            continue
        wsv = wbv[ws.title]
        sp = paths.get(ws.title)
        x14 = read_x14_rules(zf, sp) if sp else []
        mr_, mc_, _ = used_extent(ws, wsv)
        cf_map = build_cf_map(ws, wsv, wbv, colors, x14, mr_ + 60, mc_ + 5)
        notes, links = {}, {}
        for row in ws.iter_rows():
            for c in row:
                if c.comment is not None:
                    notes[c.coordinate] = re.sub(r"\s+\n", "\n", c.comment.text.strip())
                if c.hyperlink is not None and c.hyperlink.target:
                    links[c.coordinate] = c.hyperlink.target
        charts = sheet_chart_specs(zf, sp, wbv, colors) if sp else []
        sheets.append(export_sheet(ws, wsv, colors, stylet, cf_map, notes, links, charts))
        print("  exported %-34s %4d rows x %3d cols, %5d cells%s" % (
            ws.title, sheets[-1]["rows"], sheets[-1]["cols"], sum(len(v) for v in sheets[-1]["cells"].values()),
            ", %d chart(s)" % len(charts) if charts else ""))

    data = {
        "meta": {"version": version, "date": date_label, "source": base,
                 "exported": datetime.datetime.now().strftime("%Y-%m-%d %H:%M")},
        "styles": stylet.items,
        "sheets": sheets,
    }
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    size = os.path.getsize(args.out)
    print("\nWrote %s  (%.2f MB, %d sheets, %d distinct styles)" % (args.out, size / 1e6, len(sheets), len(stylet.items)))


if __name__ == "__main__":
    main()
