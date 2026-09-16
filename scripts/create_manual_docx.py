from __future__ import annotations

import re
import os
from pathlib import Path
from typing import Iterable, List, Optional, Sequence

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor


ROOT = Path(r"E:\DisciMind")
SOURCE_CANDIDATES = [
    Path(os.environ["DISCIMIND_SOURCE_MD"]) if os.environ.get("DISCIMIND_SOURCE_MD") else Path("__missing__"),
    Path(r"C:\Users\30455\Desktop\学研智擎_DisciMind_软件使用说明书.md"),
    ROOT / "docs" / "学研智擎_DisciMind_软件使用说明书.md",
]
OUTPUT = Path(os.environ.get("DISCIMIND_OUTPUT_DOCX", r"C:\Users\30455\Desktop\学研智擎_DisciMind_软件使用说明书.docx"))

NAVY = "1B2A4A"
SLATE = "64748B"
BODY = "1E293B"
LIGHT_BLUE = "E8EEF5"
LIGHT_GRAY = "F4F6F9"
LIGHT_YELLOW = "FFF8E8"
WHITE = "FFFFFF"
RULE = "CBD5E1"


def first_existing(paths: Sequence[Path]) -> Path:
    for path in paths:
        if path.exists():
            return path
    raise FileNotFoundError("未找到 Markdown 说明书")


def set_cell_shading(cell, fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)


def set_cell_margins(cell, top=90, start=110, bottom=90, end=110) -> None:
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for m, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{m}"))
        if node is None:
            node = OxmlElement(f"w:{m}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def set_cell_borders(cell, color=RULE, size="4") -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    borders = tc_pr.first_child_found_in("w:tcBorders")
    if borders is None:
        borders = OxmlElement("w:tcBorders")
        tc_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        tag = f"w:{edge}"
        node = borders.find(qn(tag))
        if node is None:
            node = OxmlElement(tag)
            borders.append(node)
        node.set(qn("w:val"), "single")
        node.set(qn("w:sz"), size)
        node.set(qn("w:space"), "0")
        node.set(qn("w:color"), color)


def set_repeat_table_header(row) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    tbl_header = OxmlElement("w:tblHeader")
    tbl_header.set(qn("w:val"), "true")
    tr_pr.append(tbl_header)


def set_table_widths(table, widths: Sequence[float]) -> None:
    table.autofit = False
    for row in table.rows:
        for idx, width in enumerate(widths):
            row.cells[idx].width = Inches(width)
            row.cells[idx]._tc.get_or_add_tcPr().get_or_add_tcW().set(qn("w:w"), str(int(width * 1440)))
            row.cells[idx]._tc.get_or_add_tcPr().get_or_add_tcW().set(qn("w:type"), "dxa")


def set_run_font(run, name="微软雅黑", size=10.5, color=BODY, bold=None, italic=None) -> None:
    run.font.name = name
    run._element.get_or_add_rPr().rFonts.set(qn("w:ascii"), name)
    run._element.get_or_add_rPr().rFonts.set(qn("w:hAnsi"), name)
    run._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), name)
    run.font.size = Pt(size)
    if color:
        run.font.color.rgb = RGBColor.from_string(color)
    if bold is not None:
        run.bold = bold
    if italic is not None:
        run.italic = italic


def style_paragraph(paragraph, *, before=0, after=6, line=1.15, alignment=None) -> None:
    fmt = paragraph.paragraph_format
    fmt.space_before = Pt(before)
    fmt.space_after = Pt(after)
    fmt.line_spacing = line
    if alignment is not None:
        paragraph.alignment = alignment


def clear_paragraph(paragraph) -> None:
    for run in list(paragraph.runs):
        paragraph._p.remove(run._r)


def add_field(paragraph, instruction: str) -> None:
    run = paragraph.add_run()
    fld_char_begin = OxmlElement("w:fldChar")
    fld_char_begin.set(qn("w:fldCharType"), "begin")
    instr_text = OxmlElement("w:instrText")
    instr_text.set(qn("xml:space"), "preserve")
    instr_text.text = instruction
    fld_char_sep = OxmlElement("w:fldChar")
    fld_char_sep.set(qn("w:fldCharType"), "separate")
    text = OxmlElement("w:t")
    text.text = "目录将在 Word 中自动更新"
    fld_char_end = OxmlElement("w:fldChar")
    fld_char_end.set(qn("w:fldCharType"), "end")
    run._r.append(fld_char_begin)
    run._r.append(instr_text)
    run._r.append(fld_char_sep)
    run._r.append(text)
    run._r.append(fld_char_end)


def add_page_field(paragraph) -> None:
    run = paragraph.add_run()
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = " PAGE "
    separate = OxmlElement("w:fldChar")
    separate.set(qn("w:fldCharType"), "separate")
    text = OxmlElement("w:t")
    text.text = "1"
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    run._r.extend([begin, instr, separate, text, end])


def set_update_fields(doc: Document) -> None:
    settings = doc.settings.element
    update = settings.find(qn("w:updateFields"))
    if update is None:
        update = OxmlElement("w:updateFields")
        settings.append(update)
    update.set(qn("w:val"), "true")


def add_footer(section) -> None:
    footer = section.footer
    p = footer.paragraphs[0]
    clear_paragraph(p)
    style_paragraph(p, before=0, after=0, line=1.0, alignment=WD_ALIGN_PARAGRAPH.CENTER)
    r = p.add_run("学研智擎 · DisciMind  软件使用说明书  |  ")
    set_run_font(r, size=8.5, color=SLATE)
    add_page_field(p)
    for run in p.runs:
        if run.text == "":
            set_run_font(run, size=8.5, color=SLATE)


def configure_styles(doc: Document) -> None:
    normal = doc.styles["Normal"]
    normal.font.name = "微软雅黑"
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), "微软雅黑")
    normal.font.size = Pt(10.5)
    normal.font.color.rgb = RGBColor.from_string(BODY)
    normal.paragraph_format.space_after = Pt(6)
    normal.paragraph_format.line_spacing = 1.15

    h1 = doc.styles["Heading 1"]
    h1.font.name = "微软雅黑"
    h1._element.rPr.rFonts.set(qn("w:eastAsia"), "微软雅黑")
    h1.font.size = Pt(16)
    h1.font.bold = True
    h1.font.color.rgb = RGBColor.from_string(NAVY)
    h1.paragraph_format.space_before = Pt(10)
    h1.paragraph_format.space_after = Pt(7)
    h1.paragraph_format.keep_with_next = True

    h2 = doc.styles["Heading 2"]
    h2.font.name = "微软雅黑"
    h2._element.rPr.rFonts.set(qn("w:eastAsia"), "微软雅黑")
    h2.font.size = Pt(13)
    h2.font.bold = True
    h2.font.color.rgb = RGBColor.from_string(NAVY)
    h2.paragraph_format.space_before = Pt(8)
    h2.paragraph_format.space_after = Pt(5)
    h2.paragraph_format.keep_with_next = True

    h3 = doc.styles["Heading 3"]
    h3.font.name = "微软雅黑"
    h3._element.rPr.rFonts.set(qn("w:eastAsia"), "微软雅黑")
    h3.font.size = Pt(11.5)
    h3.font.bold = True
    h3.font.color.rgb = RGBColor.from_string(SLATE)
    h3.paragraph_format.space_before = Pt(6)
    h3.paragraph_format.space_after = Pt(4)
    h3.paragraph_format.keep_with_next = True

    for style_name in ("List Number", "List Bullet"):
        st = doc.styles[style_name]
        st.font.name = "微软雅黑"
        st._element.rPr.rFonts.set(qn("w:eastAsia"), "微软雅黑")
        st.font.size = Pt(10.5)
        st.font.color.rgb = RGBColor.from_string(BODY)
        st.paragraph_format.space_after = Pt(3)
        st.paragraph_format.line_spacing = 1.15

    if "CaptionCustom" not in [s.name for s in doc.styles]:
        cap = doc.styles.add_style("CaptionCustom", WD_STYLE_TYPE.PARAGRAPH)
    else:
        cap = doc.styles["CaptionCustom"]
    cap.font.name = "微软雅黑"
    cap._element.rPr.rFonts.set(qn("w:eastAsia"), "微软雅黑")
    cap.font.size = Pt(9.5)
    cap.font.italic = True
    cap.font.color.rgb = RGBColor.from_string(SLATE)
    cap.paragraph_format.space_before = Pt(2)
    cap.paragraph_format.space_after = Pt(8)
    cap.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER


def add_cover(doc: Document, meta: dict) -> None:
    p = doc.add_paragraph()
    style_paragraph(p, before=52, after=8, line=1.15, alignment=WD_ALIGN_PARAGRAPH.CENTER)
    r = p.add_run("软件使用说明书")
    set_run_font(r, size=20, color=NAVY, bold=True)

    p = doc.add_paragraph()
    style_paragraph(p, before=0, after=8, line=1.15, alignment=WD_ALIGN_PARAGRAPH.CENTER)
    r = p.add_run(meta["full"])
    set_run_font(r, size=30, color=NAVY, bold=True)

    p = doc.add_paragraph()
    style_paragraph(p, before=0, after=14, line=1.15, alignment=WD_ALIGN_PARAGRAPH.CENTER)
    r = p.add_run(f'{meta["short"]}  |  {meta["english"]}')
    set_run_font(r, size=13, color=SLATE)

    if meta.get("role"):
        p = doc.add_paragraph()
        style_paragraph(p, before=0, after=10, line=1.15, alignment=WD_ALIGN_PARAGRAPH.CENTER)
        r = p.add_run(f'{meta["role"]}操作分册')
        set_run_font(r, size=14, color=NAVY, bold=True)

    p = doc.add_paragraph()
    style_paragraph(p, before=0, after=30, line=1.15, alignment=WD_ALIGN_PARAGRAPH.CENTER)
    r = p.add_run("面向高等教育教学、学习与科研辅助的垂类大模型应用平台")
    set_run_font(r, size=11.5, color=SLATE)

    table = doc.add_table(rows=4, cols=2)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    set_table_widths(table, [2.1, 4.65])
    values = [
        ("软件全称", meta["full"]),
        ("软件简称", meta["short"]),
        ("英文标识", meta["english"]),
        ("文档版本", meta["version"]),
    ]
    for row, (label, value) in zip(table.rows, values):
        for cell in row.cells:
            set_cell_margins(cell)
            set_cell_borders(cell)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            set_cell_shading(cell, LIGHT_BLUE)
        row.cells[0].text = label
        row.cells[1].text = value
        for cell in row.cells:
            p = cell.paragraphs[0]
            style_paragraph(p, before=0, after=0, line=1.0)
            for run in p.runs:
                set_run_font(run, size=10.5, color=BODY, bold=cell is row.cells[0])

    p = doc.add_paragraph()
    style_paragraph(p, before=22, after=0, line=1.0, alignment=WD_ALIGN_PARAGRAPH.CENTER)
    r = p.add_run("（本说明书中的截图位置使用模拟截图标记）")
    set_run_font(r, size=9.5, color=SLATE, italic=True)


def add_toc(doc: Document) -> None:
    doc.add_page_break()
    p = doc.add_paragraph()
    p.style = doc.styles["Heading 1"]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    clear_paragraph(p)
    r = p.add_run("目录")
    set_run_font(r, size=18, color=NAVY, bold=True)
    style_paragraph(p, before=0, after=14, line=1.0, alignment=WD_ALIGN_PARAGRAPH.CENTER)

    toc = doc.add_paragraph()
    style_paragraph(toc, before=0, after=0, line=1.0)
    add_field(toc, 'TOC \\o "1-3" \\h \\z \\u')
    for run in toc.runs:
        set_run_font(run, size=10.5, color=BODY)

    p = doc.add_paragraph()
    style_paragraph(p, before=12, after=0, line=1.0, alignment=WD_ALIGN_PARAGRAPH.CENTER)
    r = p.add_run("打开文档后如目录未刷新，请按 Ctrl+A 后按 F9 更新域。")
    set_run_font(r, size=9, color=SLATE, italic=True)


def parse_meta(lines: Sequence[str]) -> dict:
    meta = {}
    for line in lines:
        if line.startswith("软件全称："):
            meta["full"] = line.split("：", 1)[1].strip()
        elif line.startswith("软件简称："):
            meta["short"] = line.split("：", 1)[1].strip()
        elif line.startswith("英文标识："):
            meta["english"] = line.split("：", 1)[1].strip()
        elif line.startswith("文档版本："):
            meta["version"] = line.split("：", 1)[1].strip()
        elif line.startswith("使用端："):
            meta["role"] = line.split("：", 1)[1].strip()
    return meta


def split_table_row(line: str) -> List[str]:
    line = line.strip()
    if line.startswith("|"):
        line = line[1:]
    if line.endswith("|"):
        line = line[:-1]
    return [part.strip() for part in line.split("|")]


def is_table_separator(line: str) -> bool:
    cells = split_table_row(line)
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", c.replace(" ", "")) for c in cells)


def is_table_start(lines: Sequence[str], idx: int) -> bool:
    return (
        idx + 1 < len(lines)
        and lines[idx].strip().startswith("|")
        and is_table_separator(lines[idx + 1])
    )


def is_note_table(rows: Sequence[Sequence[str]]) -> bool:
    return len(rows) == 1 and len(rows[0]) == 1


def add_inline_runs(paragraph, text: str, *, size=10.5, color=BODY) -> None:
    token_re = re.compile(r"(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)")
    pos = 0
    for match in token_re.finditer(text):
        if match.start() > pos:
            r = paragraph.add_run(text[pos : match.start()])
            set_run_font(r, size=size, color=color)
        token = match.group(0)
        if token.startswith("`"):
            r = paragraph.add_run(token[1:-1])
            set_run_font(r, name="Consolas", size=size - 0.2, color=NAVY)
        elif token.startswith("**"):
            r = paragraph.add_run(token[2:-2])
            set_run_font(r, size=size, color=color, bold=True)
        else:
            r = paragraph.add_run(token[1:-1])
            set_run_font(r, size=size, color=color, italic=True)
        pos = match.end()
    if pos < len(text):
        r = paragraph.add_run(text[pos:])
        set_run_font(r, size=size, color=color)


def add_body_paragraph(doc: Document, text: str, style=None) -> None:
    p = doc.add_paragraph(style=style or "Normal")
    style_paragraph(p, before=0, after=6, line=1.15)
    # Body paragraphs follow the reference manual's Chinese technical-writing
    # convention: the first line is indented by two characters. Tables,
    # headings, screenshot markers and captions intentionally remain flush.
    p.paragraph_format.first_line_indent = Inches(0.28)
    add_inline_runs(p, text)


def add_numbered_item(doc: Document, text: str) -> None:
    p = doc.add_paragraph(style="List Number")
    style_paragraph(p, before=0, after=3, line=1.15)
    add_inline_runs(p, text)


def add_bullet_item(doc: Document, text: str) -> None:
    p = doc.add_paragraph(style="List Bullet")
    style_paragraph(p, before=0, after=3, line=1.15)
    add_inline_runs(p, text)


def add_heading(doc: Document, text: str, level: int) -> None:
    p = doc.add_paragraph(style=f"Heading {level}")
    if level == 1:
        # Use the heading paragraph's own pagination rule instead of inserting
        # a standalone page-break paragraph. A standalone break can be pushed
        # onto the next page by preceding content and create an empty page.
        # The first body heading follows the TOC's own page break, so it must
        # not receive a second break.
        # If a preceding table has a single continuation row, letting these
        # two chapters flow naturally prevents an otherwise mostly empty page.
        # The remaining top-level chapters still begin on a fresh page.
        flow_after_table = text.startswith("二、运行环境与部署") or text.startswith("五、异常处理与数据安全")
        if getattr(doc, "_body_heading_seen", False) and not flow_after_table:
            p.paragraph_format.page_break_before = True
        else:
            doc._body_heading_seen = True
    style_paragraph(p, before=0 if level == 1 else 8, after=7 if level == 1 else 5, line=1.0)
    r = p.add_run(text)
    set_run_font(r, size={1: 16, 2: 13, 3: 11.5}[level], color=NAVY if level < 3 else SLATE, bold=True)


def add_screenshot_marker(doc: Document, text: str) -> None:
    p = doc.add_paragraph()
    style_paragraph(p, before=5, after=2, line=1.0, alignment=WD_ALIGN_PARAGRAPH.CENTER)
    p_pr = p._p.get_or_add_pPr()
    borders = OxmlElement("w:pBdr")
    for edge in ("top", "left", "bottom", "right"):
        node = OxmlElement(f"w:{edge}")
        node.set(qn("w:val"), "single")
        node.set(qn("w:sz"), "8")
        node.set(qn("w:space"), "5")
        node.set(qn("w:color"), "94A3B8")
        borders.append(node)
    p_pr.append(borders)
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), "F8FAFC")
    p_pr.append(shd)
    r = p.add_run(text)
    set_run_font(r, size=10.5, color=SLATE, italic=True)


def add_caption(doc: Document, text: str) -> None:
    p = doc.add_paragraph(style="CaptionCustom")
    clear_paragraph(p)
    style_paragraph(p, before=1, after=8, line=1.0, alignment=WD_ALIGN_PARAGRAPH.CENTER)
    r = p.add_run(text)
    set_run_font(r, size=9.5, color=SLATE, italic=True)


def add_note_table(doc: Document, header: str, body: str) -> None:
    table = doc.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    set_table_widths(table, [6.75])
    cell = table.cell(0, 0)
    set_cell_margins(cell, top=100, start=140, bottom=100, end=140)
    set_cell_borders(cell, color="D6DDE8", size="4")
    fill = LIGHT_YELLOW if any(key in header for key in ("服务", "推荐", "结果", "图表")) else LIGHT_GRAY
    set_cell_shading(cell, fill)
    p = cell.paragraphs[0]
    style_paragraph(p, before=0, after=0, line=1.15)
    label = p.add_run(f"{header}  ")
    set_run_font(label, size=9.5, color=NAVY, bold=True)
    value = p.add_run(body)
    set_run_font(value, size=9.5, color=BODY)
    spacer = doc.add_paragraph()
    style_paragraph(spacer, before=0, after=1, line=1.0)


def add_markdown_table(doc: Document, rows: List[List[str]]) -> None:
    if not rows:
        return
    cols = max(len(row) for row in rows)
    rows = [row + [""] * (cols - len(row)) for row in rows]
    table = doc.add_table(rows=len(rows), cols=cols)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.style = "Table Grid"
    if cols == 1:
        widths = [6.75]
    elif cols == 2:
        widths = [2.0, 4.75]
    elif cols == 3:
        widths = [0.8, 3.55, 2.4]
    else:
        widths = [6.75 / cols] * cols
    set_table_widths(table, widths)
    set_repeat_table_header(table.rows[0])
    for r_idx, row in enumerate(rows):
        for c_idx, value in enumerate(row):
            cell = table.cell(r_idx, c_idx)
            set_cell_margins(cell)
            set_cell_borders(cell)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            if r_idx == 0:
                set_cell_shading(cell, NAVY)
            else:
                set_cell_shading(cell, LIGHT_BLUE if r_idx % 2 == 1 else WHITE)
            cell.text = ""
            p = cell.paragraphs[0]
            style_paragraph(p, before=0, after=0, line=1.0)
            add_inline_runs(p, value, size=9.2, color=WHITE if r_idx == 0 else BODY)
            for run in p.runs:
                if r_idx == 0:
                    run.bold = True
    spacer = doc.add_paragraph()
    style_paragraph(spacer, before=0, after=1, line=1.0)


def add_markdown_body(doc: Document, source_text: str) -> None:
    lines = source_text.splitlines()
    meta = parse_meta(lines)
    add_cover(doc, meta)
    add_toc(doc)

    start = next((idx for idx, line in enumerate(lines) if line.startswith("## 一、")), 0)
    i = start
    while i < len(lines):
        line = lines[i].rstrip()
        stripped = line.strip()
        if not stripped:
            i += 1
            continue
        if stripped.startswith("## "):
            add_heading(doc, stripped[3:].strip(), 1)
            i += 1
            continue
        if stripped.startswith("### "):
            add_heading(doc, stripped[4:].strip(), 2)
            i += 1
            continue
        if stripped.startswith("#### "):
            add_heading(doc, stripped[5:].strip(), 3)
            i += 1
            continue
        if is_table_start(lines, i):
            rows = [split_table_row(lines[i])]
            i += 2
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append(split_table_row(lines[i]))
                i += 1
            if len(rows) == 2 and len(rows[0]) == len(rows[1]) == 1:
                add_note_table(doc, rows[0][0], rows[1][0])
            else:
                add_markdown_table(doc, rows)
            continue
        if stripped.startswith("【模拟截图："):
            add_screenshot_marker(doc, stripped)
            i += 1
            continue
        if re.match(r"^图\d+\s", stripped):
            add_caption(doc, stripped)
            i += 1
            continue
        if stripped.startswith("> "):
            add_body_paragraph(doc, stripped[2:].strip())
            i += 1
            continue
        number_match = re.match(r"^\d+\.\s+(.*)$", stripped)
        if number_match:
            # The source Markdown may use numbers to clarify a workflow, but
            # the delivered manual uses indented prose paragraphs to avoid an
            # overly dense sequence of visible numbers.
            add_body_paragraph(doc, number_match.group(1))
            i += 1
            continue
        bullet_match = re.match(r"^[-*]\s+(.*)$", stripped)
        if bullet_match:
            add_bullet_item(doc, bullet_match.group(1))
            i += 1
            continue
        if stripped.startswith("# "):
            i += 1
            continue
        add_body_paragraph(doc, stripped)
        i += 1


def build() -> None:
    source = first_existing(SOURCE_CANDIDATES)
    text = source.read_text(encoding="utf-8")
    doc = Document()
    section = doc.sections[0]
    section.page_width = Inches(8.27)
    section.page_height = Inches(11.69)
    section.left_margin = Inches(0.89)
    section.right_margin = Inches(0.89)
    section.top_margin = Inches(0.83)
    section.bottom_margin = Inches(0.63)
    section.header_distance = Inches(0.25)
    section.footer_distance = Inches(0.25)
    configure_styles(doc)
    add_footer(section)
    set_update_fields(doc)
    add_markdown_body(doc, text)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc.save(OUTPUT)
    print(OUTPUT)


if __name__ == "__main__":
    build()
