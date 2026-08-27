"""
PDF manifest generation — ported from app.py's generate_pdf_manifest
(lines 1528-1789), generate_garment_pdf_manifest (lines 1794-2184), and
dispatch_pdf_manifest (lines 2189-2193). Kept as close to the original
reportlab code as possible: same layout, same tables, same styles, same
signature/footer logic — this is a port, not a rewrite.

_is_garment mirrors app.py's _is_garment (line 791) exactly — same rule
already ported independently to src/lib/is-garment.ts on the frontend.

One deliberate deviation from source: generate_garment_pdf_manifest's
"Total/Deposit/Balance Amount" labels use "GHC" text here, not the
literal ₵ character the original embeds. The source itself is
inconsistent — generate_pdf_manifest already uses "GHC" text, only the
garment variant used the Unicode Cedi sign, which reportlab's default
Helvetica (no Cedi glyph) renders as a broken box in both this port and
the original. Confirmed via a real generated PDF before changing this.
"""
from __future__ import annotations

import io
import re
from datetime import datetime, timezone

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def _is_garment(row: dict) -> bool:
    """Central helper -- returns True when a DB row is a GARMENT department order."""
    dept = str(row.get("department") or "").strip().upper()
    if dept == "GARMENT":
        return True
    pt = str(row.get("type_of_print") or row.get("print_type") or "").strip().upper()
    return pt in ("DTF", "UV-DTF", "SAV", "EMBROIDERY", "FLEXI SCREEN PRINT")


def sanitize_customer_name_for_filename(name: str | None, max_length: int = 40) -> str:
    """Makes a real customer_name safe to drop straight into a
    Content-Disposition filename -- real names carry commas, ampersands,
    parentheses, slashes etc. that are unsafe there unescaped. Strips
    anything that isn't alphanumeric/space/hyphen, then collapses
    whitespace to underscores, then truncates. Falls back to "Customer"
    if the name is missing or sanitizes down to nothing.
    """
    cleaned = re.sub(r"[^A-Za-z0-9 -]", "", name or "").strip()
    cleaned = re.sub(r"\s+", "_", cleaned)
    return cleaned[:max_length] or "Customer"


def generate_pdf_manifest(ticket: dict) -> io.BytesIO:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4, rightMargin=36, leftMargin=36, topMargin=36, bottomMargin=36
    )
    elements = []
    styles = getSampleStyleSheet()
    bold_style = ParagraphStyle("BoldStyle", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=9)
    normal_style = ParagraphStyle("NormStyle", parent=styles["Normal"], fontName="Helvetica", fontSize=9)
    small_grey = ParagraphStyle(
        "SmallGrey", parent=styles["Normal"], fontName="Helvetica", fontSize=7,
        textColor=colors.HexColor("#64748b"),
    )

    def cb(val, match_str):
        if isinstance(val, str) and match_str.upper() in val.upper():
            return "[X]"
        return "[  ]"

    header_data = [[
        Paragraph(
            "<b>APPOINTED TIME PRINTING LTD.</b><br/>PO BOX AC 56 Art Centre Accra<br/>Tel: 0302 661704/6",
            normal_style,
        ),
        Paragraph(
            f"<font size=10 color='#64748b'>JOB ORDER / WAYBILL NO</font><br/>"
            f"<font size=14><b>{ticket.get('job_order_no', 'PENDING')}</b></font>",
            ParagraphStyle(name="R", parent=styles["Normal"], alignment=2),
        ),
    ]]
    t_header = Table(header_data, colWidths=[3.5 * inch, 3.5 * inch])
    t_header.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -1), 1, colors.HexColor("#0f172a")),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    elements.append(t_header)
    elements.append(Spacer(1, 12))

    total = float(ticket.get("total_amount", 0) or 0)
    deposit = float(ticket.get("deposit_amount", 0) or 0)
    balance = total - deposit

    # order_date falls back to created_at's date portion -- orders raised
    # before the insert-ordering fix have no order_date stored at all, so
    # this keeps existing/already-approved orders displaying correctly
    # too, not just new ones going forward.
    pdf_order_date = str(ticket.get("order_date", "") or "").strip()
    if not pdf_order_date:
        pdf_order_date = str(ticket.get("created_at", "") or "")[:10]

    cust_data = [
        [
            Paragraph("Customer Name", small_grey), Paragraph("Telephone Number", small_grey),
            Paragraph("Job Order Date", small_grey), Paragraph("Date of Collection", small_grey),
        ],
        [
            Paragraph(str(ticket.get("customer_name", "") or ""), bold_style),
            Paragraph(str(ticket.get("telephone_number", "") or ""), bold_style),
            Paragraph(pdf_order_date, bold_style),
            Paragraph(str(ticket.get("date_of_collection", "") or ""), bold_style),
        ],
        [
            Paragraph("Total Amount GHC", small_grey), Paragraph("Deposit GHC", small_grey),
            Paragraph("Balance GHC", small_grey), Paragraph("Receipt No", small_grey),
        ],
        [
            Paragraph(f"{total:,.2f}", bold_style), Paragraph(f"{deposit:,.2f}", bold_style),
            Paragraph(f"{balance:,.2f}", bold_style),
            Paragraph(str(ticket.get("receipt_no", "") or ""), bold_style),
        ],
    ]
    t_cust = Table(cust_data, colWidths=[2.2 * inch, 1.6 * inch, 1.6 * inch, 1.6 * inch])
    t_cust.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F8FAFC")),
        ("BACKGROUND", (0, 2), (-1, 2), colors.HexColor("#F8FAFC")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    elements.append(t_cust)
    elements.append(Spacer(1, 8))

    # -- Payment terms -- explicit when no deposit was taken, so nobody
    # has to infer "0.00 deposit" as either an oversight or a policy --
    pdf_terms = str(ticket.get("payment_terms", "") or "").strip()
    if balance > 0:
        is_30day_pdf = "30-Day Credit Terms" in pdf_terms
        notes_part = (
            pdf_terms.split("|", 1)[1].strip() if "|" in pdf_terms
            else (pdf_terms if not is_30day_pdf else "")
        )
        if is_30day_pdf:
            terms_text = "PAYMENT TERMS: 30-Day Credit — payment due within 30 days of collection."
            if notes_part:
                terms_text += f" Note: {notes_part}"
        elif notes_part:
            terms_text = f"PAYMENT TERMS: {notes_part}"
        else:
            terms_text = "PAYMENT TERMS: Full payment due before collection — no arrangement specified for this outstanding balance."
        elements.append(Paragraph(
            terms_text,
            ParagraphStyle(
                "TermsNote", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=8.5,
                textColor=colors.HexColor("#92400e"), backColor=colors.HexColor("#fffbeb"),
                borderColor=colors.HexColor("#fde68a"), borderWidth=1, borderPadding=6,
            ),
        ))
        elements.append(Spacer(1, 8))

    pdf_sample = str(ticket.get("sample_attached", "") or "").strip()
    if pdf_sample == "Yes":
        elements.append(Paragraph(
            f"SAMPLE ATTACHED — with: {str(ticket.get('sample_with', '') or '—')}",
            ParagraphStyle(
                "SampleNote", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=8.5,
                textColor=colors.HexColor("#0369a1"), backColor=colors.HexColor("#f0f9ff"),
                borderColor=colors.HexColor("#bae6fd"), borderWidth=1, borderPadding=6,
            ),
        ))
        elements.append(Spacer(1, 8))

    pdf_sales_rep = str(ticket.get("sales_rep", "") or "").strip()
    if pdf_sales_rep:
        elements.append(Paragraph(
            f"SALES REP: {pdf_sales_rep}",
            ParagraphStyle(
                "SalesRepNote", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=8.5,
                textColor=colors.HexColor("#334155"), backColor=colors.HexColor("#f8fafc"),
                borderColor=colors.HexColor("#e2e8f0"), borderWidth=1, borderPadding=6,
            ),
        ))
        elements.append(Spacer(1, 8))

    type_print = str(ticket.get("type_of_print", "") or "").strip() or "—"
    mat_source = str(ticket.get("material_source", "") or "").strip() or "—"
    cat_data = [
        [Paragraph("TYPE OF PRINT", bold_style), Paragraph(type_print, normal_style)],
        [Paragraph("MATERIAL SOURCE", bold_style), Paragraph(mat_source, normal_style)],
    ]
    t_cat = Table(cat_data, colWidths=[2.0 * inch, 5.0 * inch])
    t_cat.setStyle(TableStyle([
        ("LINEBELOW", (0, 0), (-1, -1), 0.5, colors.HexColor("#E2E8F0")),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    elements.append(t_cat)
    elements.append(Spacer(1, 12))
    elements.append(Paragraph("JOB DESCRIPTION", small_grey))
    desc_data = [[Paragraph(str(ticket.get("job_description", "") or ""), normal_style)]]
    t_desc = Table(desc_data, colWidths=[7.0 * inch], rowHeights=[1.2 * inch])
    t_desc.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
    ]))
    elements.append(t_desc)
    elements.append(Spacer(1, 6))

    size_data = [[
        Paragraph("PRINT SIZE: " + str(ticket.get("print_size", "") or ""), normal_style),
        Paragraph("FINISHED PRINT SIZE: " + str(ticket.get("finished_print_size", "") or ""), normal_style),
    ]]
    t_size = Table(size_data, colWidths=[3.5 * inch, 3.5 * inch])
    elements.append(t_size)
    elements.append(Spacer(1, 12))

    mat_grid = [
        [
            Paragraph("Material Description (Paper)", small_grey), Paragraph("GSM", small_grey),
            Paragraph("Size", small_grey), Paragraph("Paper Colour", small_grey),
        ],
        [
            Paragraph(str(ticket.get("paper_type", "-") or "-"), normal_style),
            Paragraph(str(ticket.get("gsm", "-") or "-"), normal_style),
            Paragraph(str(ticket.get("paper_size", "-") or "-"), normal_style),
            Paragraph(str(ticket.get("paper_colour", "-") or "-"), normal_style),
        ],
    ]
    t_mat = Table(mat_grid, colWidths=[2.5 * inch, 1.0 * inch, 1.5 * inch, 2.0 * inch])
    t_mat.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F8FAFC")),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    elements.append(t_mat)
    elements.append(Spacer(1, 12))

    bind_type = str(ticket.get("binding_type", "") or "")
    lam_type = str(ticket.get("laminating_type", "") or "")
    del_mode = str(ticket.get("delivery_mode", "") or "")
    # Field name varies by submission path (Press vs Garment, single vs
    # batch) -- check every real name quantity is ever stored under.
    pdf_qty = (
        ticket.get("qty_to_print") or ticket.get("print_qty")
        or ticket.get("qty_to_pack") or ticket.get("quantity") or "-"
    )
    finishing_data = [
        [
            Paragraph("QUANTITY", bold_style), Paragraph(str(pdf_qty), normal_style),
            Paragraph("IMPRESSION", bold_style),
            Paragraph(str(ticket.get("impressions_colour", "-") or "-"), normal_style),
        ],
        [
            Paragraph("DELIVERY MODE", bold_style), Paragraph(del_mode.strip() or "—", normal_style),
            Paragraph("", normal_style), Paragraph("", normal_style),
        ],
        [
            Paragraph("BINDING", bold_style), Paragraph(bind_type.strip() or "None", normal_style),
            Paragraph("LAMINATING", bold_style), Paragraph(lam_type.strip() or "None", normal_style),
        ],
    ]
    t_fin = Table(finishing_data, colWidths=[1.2 * inch, 2.3 * inch, 1.2 * inch, 2.3 * inch])
    t_fin.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEABOVE", (0, 0), (-1, -1), 0.5, colors.HexColor("#E2E8F0")),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    elements.append(t_fin)
    elements.append(Spacer(1, 30))

    # -- Pull live approval fields from the ticket --
    fp_prep_by = str(ticket.get("created_by", "") or "").strip()
    fp_auth_by = str(ticket.get("approved_by", "") or "").strip()
    fp_ord_date = pdf_order_date
    fp_appr_raw = str(ticket.get("approval_date", "") or ticket.get("updated_at", "") or "").strip()

    def fmt_ts(raw: str) -> str:
        if not raw or raw in ("-", "None", "nan"):
            return ""
        try:
            clean = raw.replace("Z", "+00:00")
            dt = datetime.fromisoformat(clean)
            return dt.strftime("%d %b %Y  %H:%M UTC")
        except Exception:
            return raw

    fp_appr_date_fmt = fmt_ts(fp_appr_raw)

    # Signature-construction helper:
    # Produces an uppercase-initials stamp + full name in italic
    # e.g. "K.A.B" / "Kwame Asante Boateng" -> "K.A.B. -- Kwame Asante Boateng"
    def build_sig(full_name: str) -> str:
        if not full_name or full_name in ("-", "None", "nan", "Guest"):
            return "......................................."
        parts = [p for p in full_name.split() if p]
        initials = ".".join(w[0].upper() for w in parts) + "."
        return f"{initials}  —  {full_name}"

    fp_is_approved = bool(fp_auth_by and fp_auth_by not in ("-", "None", "nan", "Guest"))

    sig_style = ParagraphStyle(
        "SigStyle", parent=styles["Normal"], fontName="Helvetica-BoldOblique", fontSize=9,
        textColor=colors.HexColor("#0f172a"),
    )

    prep_label = f"Prepared by:  {fp_prep_by}" if fp_prep_by else "Prepared by: ......................................."
    auth_label = f"Authorized by:  {fp_auth_by}" if fp_is_approved else "Authorized by: ......................................"
    appr_date_label = f"Approved Date:  {fp_appr_date_fmt}" if fp_appr_date_fmt else "Approved Date: ........................."

    footer_data = [
        [
            Paragraph(prep_label, normal_style), Paragraph("Sign: .......................", normal_style),
            Paragraph(f"Date:  {fp_ord_date}", normal_style),
        ],
        [
            Paragraph(auth_label, normal_style),
            Paragraph(
                build_sig(fp_auth_by) if fp_is_approved else "Sign: .......................",
                sig_style if fp_is_approved else normal_style,
            ),
            Paragraph(appr_date_label, normal_style),
        ],
        [Paragraph("<i>JOB APPROVAL / JOB HISTORY USE ONLY</i>", normal_style), "", ""],
    ]
    t_foot = Table(footer_data, colWidths=[3.0 * inch, 2.0 * inch, 2.0 * inch])
    t_foot.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LINEABOVE", (0, 0), (-1, 0), 0.75, colors.HexColor("#0f172a")),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("BACKGROUND", (0, 1), (-1, 1),
         colors.HexColor("#f0fdf4") if fp_is_approved else colors.HexColor("#f8fafc")),
    ]))
    elements.append(t_foot)
    doc.build(elements)
    buffer.seek(0)
    return buffer


def generate_garment_pdf_manifest(ticket: dict) -> io.BytesIO:
    """Dedicated ReportLab PDF generator for Garment department orders.
    Layout mirrors the physical GARMENT waybill template exactly."""
    buffer = io.BytesIO()
    # Safe page width: A4 = 595pt. Margins 32pt each side -> usable = 531pt = 7.375in
    doc = SimpleDocTemplate(
        buffer, pagesize=A4, rightMargin=32, leftMargin=32, topMargin=32, bottomMargin=32
    )
    elements = []
    styles = getSampleStyleSheet()
    full_w = 7.375 * inch  # total usable column width

    bold_s = ParagraphStyle("GB", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=9)
    norm_s = ParagraphStyle("GN", parent=styles["Normal"], fontName="Helvetica", fontSize=9)
    small_s = ParagraphStyle(
        "GS", parent=styles["Normal"], fontName="Helvetica", fontSize=7,
        textColor=colors.HexColor("#64748b"),
    )
    white_b = ParagraphStyle(
        "GWB", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=8, textColor=colors.white
    )
    navy = colors.HexColor("#0f172a")
    slate = colors.HexColor("#CBD5E1")
    light = colors.HexColor("#F8FAFC")

    def cb(val, match_str):
        if isinstance(val, str) and match_str.upper() in val.upper():
            return "[X]"
        return "[  ]"

    def safe(v, default="-"):
        return str(v or default).strip() or default

    # -- HEADER --
    order_no = safe(ticket.get("job_order_no", "PENDING"), "PENDING")
    hdr_data = [[
        Paragraph(
            "<b>APPOINTED TIME PRINTING</b><br/>P.O BOX AC 56 Art Centre Accra<br/>Tel: 0302 689704/6",
            norm_s,
        ),
        Paragraph(
            "<b>JOB ORDER</b>",
            ParagraphStyle("GT", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=14),
        ),
        Paragraph(
            f"<font size=7 color='#64748b'>WAYBILL NO:</font> <b>{order_no}</b><br/>"
            f"<font size=7 color='#64748b'>JOB ORDER NO:</font> <b>{order_no}</b>",
            ParagraphStyle("GR", parent=styles["Normal"], alignment=2, fontSize=8),
        ),
    ]]
    t_hdr = Table(hdr_data, colWidths=[2.6 * inch, 2.0 * inch, 2.775 * inch])
    t_hdr.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -1), 1.5, navy),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    elements.append(t_hdr)
    elements.append(Spacer(1, 5))

    # -- DEPT BAR --
    dept_val = safe(ticket.get("department", "GARMENT"), "GARMENT").upper()
    dept_data = [[Paragraph("<b>DEPT</b>", white_b), Paragraph(dept_val, norm_s)]]
    t_dept = Table(dept_data, colWidths=[0.6 * inch, full_w - 0.6 * inch])
    t_dept.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), navy),
        ("GRID", (0, 0), (-1, -1), 0.5, slate),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    elements.append(t_dept)
    elements.append(Spacer(1, 4))

    # -- CUSTOMER / FINANCIAL MATRIX --
    total = float(ticket.get("total_amount", 0) or 0)
    deposit = float(ticket.get("deposit_amount", 0) or 0)
    balance = total - deposit
    cw = full_w / 4
    cf_data = [
        [
            Paragraph("Customer Name", small_s), Paragraph("", small_s),
            Paragraph("Total Amount GHC", small_s), Paragraph("", small_s),
        ],
        [
            Paragraph(safe(ticket.get("customer_name")), bold_s), Paragraph("", norm_s),
            Paragraph(f"{total:,.2f}", bold_s), Paragraph("", norm_s),
        ],
        [
            Paragraph("Telephone Number", small_s), Paragraph("", small_s),
            Paragraph("Deposit GHC", small_s), Paragraph("", small_s),
        ],
        [
            Paragraph(safe(ticket.get("telephone_number")), bold_s), Paragraph("", norm_s),
            Paragraph(f"{deposit:,.2f}", bold_s), Paragraph("", norm_s),
        ],
        [
            Paragraph("Order Date", small_s), Paragraph("", small_s),
            Paragraph("Balance GHC", small_s), Paragraph("", small_s),
        ],
        [
            Paragraph(safe(ticket.get("order_date") or str(ticket.get("created_at", "") or "")[:10]), bold_s),
            Paragraph("", norm_s),
            Paragraph(f"{balance:,.2f}", bold_s), Paragraph("", norm_s),
        ],
        [
            Paragraph("Date of Collection", small_s), Paragraph("Qty. to Print", small_s),
            Paragraph("Balance Due Date", small_s), Paragraph("", small_s),
        ],
        [
            Paragraph(safe(ticket.get("date_of_collection")), bold_s),
            Paragraph(str(int(ticket.get("qty_to_print", 0) or 0)), bold_s),
            Paragraph(safe(ticket.get("balance_due_date")), bold_s),
            Paragraph("", norm_s),
        ],
    ]
    t_cf = Table(cf_data, colWidths=[cw, cw, cw, cw])
    t_cf.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, slate),
        ("BACKGROUND", (0, 0), (-1, 0), light),
        ("BACKGROUND", (0, 2), (-1, 2), light),
        ("BACKGROUND", (0, 4), (-1, 4), light),
        ("BACKGROUND", (0, 6), (-1, 6), light),
        ("SPAN", (0, 0), (1, 0)), ("SPAN", (0, 1), (1, 1)),
        ("SPAN", (0, 2), (1, 2)), ("SPAN", (0, 3), (1, 3)),
        ("SPAN", (0, 4), (1, 4)), ("SPAN", (0, 5), (1, 5)),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    elements.append(t_cf)
    elements.append(Spacer(1, 5))

    g_pdf_terms = safe(ticket.get("payment_terms"), "")
    if balance > 0:
        g_is_30day_pdf = "30-Day Credit Terms" in g_pdf_terms
        g_notes_part = (
            g_pdf_terms.split("|", 1)[1].strip() if "|" in g_pdf_terms
            else (g_pdf_terms if not g_is_30day_pdf else "")
        )
        if g_is_30day_pdf:
            g_terms_text = "PAYMENT TERMS: 30-Day Credit — payment due within 30 days of collection."
            if g_notes_part:
                g_terms_text += f" Note: {g_notes_part}"
        elif g_notes_part:
            g_terms_text = f"PAYMENT TERMS: {g_notes_part}"
        else:
            g_terms_text = "PAYMENT TERMS: Full payment due before collection — no arrangement specified for this outstanding balance."
        elements.append(Paragraph(
            g_terms_text,
            ParagraphStyle(
                "GTermsNote", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=8.5,
                textColor=colors.HexColor("#92400e"), backColor=colors.HexColor("#fffbeb"),
                borderColor=colors.HexColor("#fde68a"), borderWidth=1, borderPadding=6,
            ),
        ))
        elements.append(Spacer(1, 5))

    g_pdf_sample = safe(ticket.get("sample_attached"), "")
    if g_pdf_sample == "Yes":
        elements.append(Paragraph(
            f"SAMPLE ATTACHED — with: {safe(ticket.get('sample_with'))}",
            ParagraphStyle(
                "GSampleNote", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=8.5,
                textColor=colors.HexColor("#0369a1"), backColor=colors.HexColor("#f0f9ff"),
                borderColor=colors.HexColor("#bae6fd"), borderWidth=1, borderPadding=6,
            ),
        ))
        elements.append(Spacer(1, 5))

    g_pdf_sales_rep = safe(ticket.get("sales_rep"), "")
    if g_pdf_sales_rep:
        elements.append(Paragraph(
            f"SALES REP: {g_pdf_sales_rep}",
            ParagraphStyle(
                "GSalesRepNote", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=8.5,
                textColor=colors.HexColor("#334155"), backColor=colors.HexColor("#f8fafc"),
                borderColor=colors.HexColor("#e2e8f0"), borderWidth=1, borderPadding=6,
            ),
        ))
        elements.append(Spacer(1, 5))

    # -- TYPE OF PRINT --
    type_print = safe(ticket.get("print_type") or ticket.get("type_of_print"), "").strip() or "—"
    mat_source = safe(ticket.get("material_source"), "").strip() or "—"
    tp_data = [
        [Paragraph("<b>TYPE OF PRINT</b>", bold_s), Paragraph(type_print, norm_s)],
        [Paragraph("<b>MATERIAL SOURCE</b>", bold_s), Paragraph(mat_source, norm_s)],
    ]
    t_tp = Table(tp_data, colWidths=[1.5 * inch, full_w - 1.5 * inch])
    t_tp.setStyle(TableStyle([
        ("LINEBELOW", (0, 0), (-1, -1), 0.5, slate),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    elements.append(t_tp)
    elements.append(Spacer(1, 4))

    # -- JOB DESCRIPTION --
    elements.append(Paragraph("JOB DESCRIPTION", small_s))
    jd_data = [[Paragraph(safe(ticket.get("job_description"), ""), norm_s)]]
    t_jd = Table(jd_data, colWidths=[full_w], rowHeights=[0.75 * inch])
    t_jd.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.5, slate),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
    ]))
    elements.append(t_jd)
    elements.append(Spacer(1, 4))

    # -- PRINT SIZE / FINISHED SIZE / YARDAGE --
    p_size = safe(ticket.get("print_size"), "")
    f_size = safe(ticket.get("finished_print_size"), "")
    yardage = safe(ticket.get("yardage"), "")
    ps_data = [
        [
            Paragraph("<b>PRINT SIZE</b>", bold_s),
            Paragraph(
                f"{cb(p_size, 'A1')} A1  {cb(p_size, 'A2')} A2  {cb(p_size, 'A3')} A3  "
                f"{cb(p_size, 'A4')} A4  {cb(p_size, 'A5')} A5  {cb(p_size, 'A6')} A6",
                norm_s,
            ),
        ],
        [
            Paragraph("<b>FINISHED PRINT SIZE</b>", bold_s),
            Paragraph(
                f"{cb(f_size, 'A1')} A1  {cb(f_size, 'A2')} A2  {cb(f_size, 'A3')} A3  "
                f"{cb(f_size, 'A4')} A4  {cb(f_size, 'A5')} A5  {cb(f_size, 'A6')} A6<br/>"
                f"{cb(yardage, '1YRD')} 1YRD  {cb(yardage, '2YRD')} 2YRDs  "
                f"{cb(yardage, '3YRD')} 3YRDs  {cb(yardage, '4YRD')} 4YRDs  "
                f"{cb(yardage, '5YRD')} 5YRDs  {cb(yardage, '6YRD')} 6YRDs  "
                f"{cb(yardage, '3FTx4FT')} 3FTx4FT  {cb(yardage, '4FTx8FT')} 4FTx8FT",
                norm_s,
            ),
        ],
    ]
    t_ps = Table(ps_data, colWidths=[1.5 * inch, full_w - 1.5 * inch])
    t_ps.setStyle(TableStyle([
        ("LINEBELOW", (0, 0), (-1, -1), 0.5, slate),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    elements.append(t_ps)
    elements.append(Spacer(1, 4))

    # -- ADDITIONAL COMMENTS --
    elements.append(Paragraph("ADDITIONAL COMMENTS", small_s))
    ac_text = safe(ticket.get("additional_comments"), "")
    ac_data = [[Paragraph(ac_text, norm_s)]]
    t_ac = Table(ac_data, colWidths=[full_w], rowHeights=[0.45 * inch])
    t_ac.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.5, slate),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
    ]))
    elements.append(t_ac)
    elements.append(Spacer(1, 5))

    # -- MATERIAL DESCRIPTION TABLE --
    mat_hdr_style = ParagraphStyle(
        "MH", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=8, textColor=colors.white
    )
    mat_rows_raw = ticket.get("material_description_rows")
    if isinstance(mat_rows_raw, list) and mat_rows_raw:
        mat_rows = mat_rows_raw
    else:
        raw_text = safe(ticket.get("material_description"), "")
        mat_rows = (
            [{"material": raw_text, "sizes": safe(ticket.get("finished_print_size"), ""), "colour": ""}]
            if raw_text and raw_text != "-" else []
        )

    mat_tbl = [[
        Paragraph("Material", mat_hdr_style),
        Paragraph("Sizes [if applicable]", mat_hdr_style),
        Paragraph("Colour [if applicable]", mat_hdr_style),
    ]]
    for mr in mat_rows[:8]:
        mat_tbl.append([
            Paragraph(safe(mr.get("material"), ""), norm_s),
            Paragraph(safe(mr.get("sizes"), ""), norm_s),
            Paragraph(safe(mr.get("colour"), ""), norm_s),
        ])
    while len(mat_tbl) < 5:
        mat_tbl.append([Paragraph("", norm_s), Paragraph("", norm_s), Paragraph("", norm_s)])
    cw3 = full_w / 3
    t_mt = Table(mat_tbl, colWidths=[cw3, cw3, cw3])
    t_mt.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), navy),
        ("GRID", (0, 0), (-1, -1), 0.5, slate),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    elements.append(t_mt)
    elements.append(Spacer(1, 4))

    # -- OTHER SPECIFICATIONS --
    other_specs = safe(ticket.get("other_specifications"), "")
    oth_data = [[
        Paragraph("Indicate any other necessary specifications", small_s),
        Paragraph(other_specs, norm_s),
    ]]
    t_oth = Table(oth_data, colWidths=[2.0 * inch, full_w - 2.0 * inch])
    t_oth.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.5, slate),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    elements.append(t_oth)
    elements.append(Spacer(1, 5))

    # -- PROCESS / TECHNICAL INFO --
    process_info = safe(ticket.get("process_info"), "")
    proc_data = [
        [Paragraph("<b>PROCESS</b>", bold_s), Paragraph(process_info, norm_s)],
        [Paragraph("Please provide additional technical Information", small_s), Paragraph("", norm_s)],
    ]
    t_proc = Table(proc_data, colWidths=[1.8 * inch, full_w - 1.8 * inch])
    t_proc.setStyle(TableStyle([
        ("LINEBELOW", (0, 0), (-1, -1), 0.5, slate),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    elements.append(t_proc)
    elements.append(Spacer(1, 5))

    # -- PACKAGING + DELIVERY MODE --
    pkg_mode = safe(ticket.get("packaging_mode"), "").strip() or "—"
    del_mode = safe(ticket.get("delivery_mode"), "").strip() or "—"
    qty_pack = safe(ticket.get("qty_to_pack"), "")
    location = safe(ticket.get("delivery_location"), "")
    contact = safe(ticket.get("delivery_contact"), "")
    pkg_specs = safe(ticket.get("packaging_specs"), "")
    half = full_w / 2
    pkg_data = [
        [Paragraph("<b>PACKAGING</b>", white_b), Paragraph("<b>DELIVERY MODE</b>", white_b)],
        [Paragraph(pkg_mode, bold_s), Paragraph(del_mode, bold_s)],
        [Paragraph(f"QTY TO PACK: {qty_pack}", norm_s), Paragraph(f"LOCATION: {location}", norm_s)],
        [Paragraph(pkg_specs, norm_s), Paragraph(f"CONTACT PERSON: {contact}", norm_s)],
    ]
    t_pkg = Table(pkg_data, colWidths=[half, half])
    t_pkg.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), navy),
        ("GRID", (0, 0), (-1, -1), 0.5, slate),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    elements.append(t_pkg)
    elements.append(Spacer(1, 18))

    # -- SIGNATURE FOOTER --
    gf_prep_by = safe(ticket.get("created_by"), "")
    gf_auth_by = safe(ticket.get("approved_by"), "")
    gf_ord_date = safe(ticket.get("order_date") or str(ticket.get("created_at", "") or "")[:10], "")
    gf_appr_raw = safe(ticket.get("approval_date", "") or ticket.get("updated_at", ""), "")

    def gf_fmt_ts(raw: str) -> str:
        if not raw or raw in ("-", "None", "nan"):
            return ""
        try:
            clean = raw.replace("Z", "+00:00")
            dt = datetime.fromisoformat(clean)
            return dt.strftime("%d %b %Y  %H:%M UTC")
        except Exception:
            return raw

    gf_appr_fmt = gf_fmt_ts(gf_appr_raw)

    def gf_build_sig(full_name: str) -> str:
        if not full_name or full_name in ("-", "None", "nan", "Guest"):
            return "......................................."
        parts = [p for p in full_name.split() if p]
        initials = ".".join(w[0].upper() for w in parts) + "."
        return f"{initials}  —  {full_name}"

    gf_is_approved = bool(gf_auth_by and gf_auth_by not in ("-", "None", "nan", "Guest", ""))

    gf_sig_style = ParagraphStyle(
        "GFSig", parent=styles["Normal"], fontName="Helvetica-BoldOblique", fontSize=9, textColor=navy
    )

    gf_prep_label = (
        f"Prepared by:  {gf_prep_by}" if gf_prep_by and gf_prep_by != "-"
        else "Prepared by: ................................."
    )
    gf_auth_label = (
        f"Authorized by:  {gf_auth_by}" if gf_is_approved
        else "Authorized by: ................................."
    )
    gf_appr_label = f"Approved Date:  {gf_appr_fmt}" if gf_appr_fmt else "Approved Date: ........................."

    foot_data = [
        [
            Paragraph(gf_prep_label, norm_s),
            Paragraph("Sign: ........................", norm_s),
            Paragraph("", norm_s),
        ],
        [
            Paragraph(gf_auth_label, norm_s),
            Paragraph(f"Prepared Date:  {gf_ord_date}", norm_s),
            Paragraph("", norm_s),
        ],
        [
            Paragraph(
                gf_build_sig(gf_auth_by) if gf_is_approved else "Sign: ........................................",
                gf_sig_style if gf_is_approved else norm_s,
            ),
            Paragraph(gf_appr_label, norm_s),
            Paragraph("", norm_s),
        ],
    ]
    t_foot = Table(foot_data, colWidths=[2.8 * inch, 2.8 * inch, full_w - 5.6 * inch])
    t_foot.setStyle(TableStyle([
        ("LINEABOVE", (0, 0), (-1, 0), 0.75, navy),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BACKGROUND", (0, 1), (-1, 2),
         colors.HexColor("#f0fdf4") if gf_is_approved else colors.HexColor("#f8fafc")),
    ]))
    elements.append(t_foot)
    doc.build(elements)
    buffer.seek(0)
    return buffer


def dispatch_pdf_manifest(row_dict: dict) -> io.BytesIO:
    """Return the correct PDF buffer for a given order row dictionary."""
    if _is_garment(row_dict):
        return generate_garment_pdf_manifest(row_dict)
    return generate_pdf_manifest(row_dict)


def generate_category_report_pdf(
    rows: list[dict], category_label: str, from_date: str, to_date: str
) -> io.BytesIO:
    """Revenue Analysis's Category Report export. Genuinely new report
    shape (a filtered tabular export, not a single order), but reuses
    the same letterhead style as generate_pdf_manifest's header (company
    block left, right-aligned title) rather than inventing a fresh look.
    `rows` is whatever the caller already queried DB-side (job_invoices
    filtered by revenue_category + date range) -- this function only
    lays it out, matching every other endpoint's "never trust
    caller-supplied data for the numbers, only for filter selection"
    posture (see /pdf/manifest's docstring): the route below re-queries
    job_invoices itself rather than accepting a client-supplied row
    list.
    """
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4, rightMargin=28, leftMargin=28, topMargin=36, bottomMargin=36
    )
    elements = []
    styles = getSampleStyleSheet()
    normal_style = ParagraphStyle("NormStyle", parent=styles["Normal"], fontName="Helvetica", fontSize=9)
    small_grey = ParagraphStyle(
        "SmallGrey", parent=styles["Normal"], fontName="Helvetica", fontSize=7,
        textColor=colors.HexColor("#64748b"),
    )
    cell_style = ParagraphStyle("Cell", parent=styles["Normal"], fontName="Helvetica", fontSize=7.5, leading=9)
    header_cell_style = ParagraphStyle(
        "HeaderCell", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=7.5,
        textColor=colors.white, leading=9,
    )
    total_style = ParagraphStyle("TotalCell", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=8)

    header_data = [[
        Paragraph(
            "<b>APPOINTED TIME PRINTING LTD.</b><br/>PO BOX AC 56 Art Centre Accra<br/>Tel: 0302 661704/6",
            normal_style,
        ),
        Paragraph(
            "<font size=10 color='#64748b'>REVENUE ANALYSIS</font><br/>"
            "<font size=14><b>CATEGORY REPORT</b></font>",
            ParagraphStyle(name="R", parent=styles["Normal"], alignment=2),
        ),
    ]]
    t_header = Table(header_data, colWidths=[3.7 * inch, 3.7 * inch])
    t_header.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -1), 1, colors.HexColor("#0f172a")),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    elements.append(t_header)
    elements.append(Spacer(1, 10))

    elements.append(Paragraph(
        f"<b>Category:</b> {category_label} &nbsp;&nbsp;|&nbsp;&nbsp; "
        f"<b>Date Range:</b> {from_date} to {to_date} &nbsp;&nbsp;|&nbsp;&nbsp; "
        f"<b>Rows:</b> {len(rows)}",
        ParagraphStyle(
            "Filters", parent=styles["Normal"], fontName="Helvetica", fontSize=9.5,
            textColor=colors.HexColor("#0f172a"), backColor=colors.HexColor("#F8FAFC"),
            borderColor=colors.HexColor("#E2E8F0"), borderWidth=1, borderPadding=6,
        ),
    ))
    elements.append(Spacer(1, 10))

    if not rows:
        elements.append(Paragraph(
            "No invoices match this category / date range.",
            ParagraphStyle("Empty", parent=styles["Normal"], fontName="Helvetica-Oblique", fontSize=10,
                           textColor=colors.HexColor("#64748b")),
        ))
        doc.build(elements)
        buffer.seek(0)
        return buffer

    # Same 11 columns, same order, as the Category Report results table on
    # screen and in the CSV export -- one source of truth for "what a
    # category report contains", just three renderings of it. Payment/
    # Balance added alongside Amount (excl./incl. tax) -- widths trimmed
    # across the board (not just appended) to still fit A4's ~7.49in
    # usable width after the 28pt margins on each side.
    columns = [
        "Date", "Order No.", "Customer", "Category", "Product",
        "Business Unit", "Qty", "Amount (excl. tax)", "Amount (incl. tax)",
        "Payment", "Balance",
    ]
    col_widths = [w * inch for w in (0.55, 0.62, 1.0, 0.75, 0.85, 0.62, 0.35, 0.72, 0.72, 0.65, 0.66)]

    table_data = [[Paragraph(c, header_cell_style) for c in columns]]
    total_amount = 0.0
    total_invoice_total = 0.0
    total_payment = 0.0
    total_balance = 0.0
    for row in rows:
        amount = float(row.get("amount") or 0)
        invoice_total = float(row.get("invoice_total") or 0)
        payment = float(row.get("payment") or 0)
        balance = float(row.get("balance") or 0)
        total_amount += amount
        total_invoice_total += invoice_total
        total_payment += payment
        total_balance += balance
        quantity = row.get("quantity")
        table_data.append([
            Paragraph(str(row.get("date", "") or ""), cell_style),
            # Blank for an unlinked invoice -- never the literal "None".
            Paragraph(str(row.get("job_order_no") or ""), cell_style),
            Paragraph(str(row.get("customer_name") or ""), cell_style),
            Paragraph(str(row.get("revenue_category") or ""), cell_style),
            Paragraph(str(row.get("product_description") or ""), cell_style),
            Paragraph(str(row.get("business_unit") or ""), cell_style),
            Paragraph(str(quantity) if quantity is not None else "", cell_style),
            Paragraph(f"{amount:,.2f}", cell_style),
            Paragraph(f"{invoice_total:,.2f}", cell_style),
            Paragraph(f"{payment:,.2f}", cell_style),
            Paragraph(f"{balance:,.2f}", cell_style),
        ])

    table_data.append([
        Paragraph("TOTAL", total_style), "", "", "", "", "", "",
        Paragraph(f"{total_amount:,.2f}", total_style),
        Paragraph(f"{total_invoice_total:,.2f}", total_style),
        Paragraph(f"{total_payment:,.2f}", total_style),
        Paragraph(f"{total_balance:,.2f}", total_style),
    ])

    t_body = Table(table_data, colWidths=col_widths, repeatRows=1)
    t_body.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f172a")),
        ("GRID", (0, 0), (-1, -2), 0.4, colors.HexColor("#E2E8F0")),
        ("LINEABOVE", (0, -1), (-1, -1), 1, colors.HexColor("#0f172a")),
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#F8FAFC")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("ALIGN", (6, 1), (10, -1), "RIGHT"),  # Qty + all four money columns, incl. the total row
    ]))
    elements.append(t_body)
    elements.append(Spacer(1, 6))
    elements.append(Paragraph(
        f"<b>Outstanding:</b> {total_balance:,.2f}",
        ParagraphStyle(
            "Outstanding", parent=styles["Normal"], fontName="Helvetica", fontSize=9.5,
            textColor=colors.HexColor("#0f172a"),
        ),
    ))
    elements.append(Spacer(1, 6))
    elements.append(Paragraph(
        f"Generated {datetime.now(timezone.utc).strftime('%d %b %Y %H:%M UTC')}", small_grey
    ))

    doc.build(elements)
    buffer.seek(0)
    return buffer
