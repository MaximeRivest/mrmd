# Tufte Markdown Table Showcase

This file demonstrates all table features including Tufte Markdown extensions.

---

## Basic Table

| Name | Role | Department |
|------|------|------------|
| Alice | Engineer | Platform |
| Bob | Designer | Product |
| Carol | Manager | Operations |

---

## Column Alignment

| Left | Center | Right |
|:-----|:------:|------:|
| L1 | C1 | R1 |
| L2 | C2 | R2 |
| L3 | C3 | R3 |

---

## Decimal Alignment (Tufte)

Numbers align on the decimal point:

| Metric | Q1 | Q2 | Q3 | Q4 |
|--------|---:|---:|---:|---:|
| Revenue | 12.50 | 100.25 | 3.33 | 1,245.00 |
| Costs | 8.00 | 50.50 | 2.10 | 30.00 |
| Profit | 4.50 | 49.75 | 1.23 | 1,215.00 |

---

## Explicit Decimal Alignment (---.)

Use `---.` in delimiter to force decimal alignment:

| Product | Sales |
|---------|----.|
| Widget A | 1,234.56 |
| Widget B | 99.99 |
| Widget C | 10,500.00 |

---

## Magnitudes (M, K, B)

| Company | Revenue | Users | Growth |
|---------|--------:|------:|-------:|
| Alpha | 1.2M | 45K | 12.5% |
| Beta | 12.5M | 500K | 8.3% |
| Gamma | 150M | 2.5M | 25.0% |

---

## Currency

| Item | Price | Tax | Total |
|------|------:|----:|------:|
| Widget | $99.99 | $8.00 | $107.99 |
| Gadget | $249.50 | $19.96 | $269.46 |
| Thing | $15.00 | $1.20 | $16.20 |

---

## Colspan (Tufte Markdown)

Use `>` to span multiple columns:

| Metric | 2024 Results | > |
|--------|:------------:|:-:|
|        | Q1 | Q2 |
| Sales | 100 | 150 |
| Users | 1000 | 1500 |

---

## Rowspan (Tufte Markdown)

Use `^` to span multiple rows:

| Category | Item | Price |
|----------|------|------:|
| Fruits | Apple | $1.00 |
| ^ | Orange | $1.25 |
| ^ | Banana | $0.75 |
| Vegetables | Carrot | $0.50 |
| ^ | Broccoli | $1.50 |

---

## Column Widths (Tufte Markdown)

Use `{width}` in delimiter to set column widths:

| Name | Description | Price |
|:--{40%}|:--{40%}|--{20%}:|
| Widget | A fantastic widget for all your needs | $9.99 |
| Gadget | Premium gadget with extra features | $19.99 |

---

## Caption Above (Tufte Markdown)

*Table 1: Quarterly Performance Metrics*
| Quarter | Revenue | Users |
|---------|--------:|------:|
| Q1 | 1.2M | 45000 |
| Q2 | 1.8M | 62000 |
| Q3 | 2.1M | 78000 |

---


## Caption Below (Scientific Style)

| Drug | Efficacy | Side Effects |
|------|:--------:|-------------:|
| Drug A | 94.5% | 12.3% |
| Drug B | 87.2% | 8.1% |
| Drug C | 91.0% | 15.5% |
*Table 2: Clinical trial results (n=500)*

---

## Combined Features

*Table 3: Regional Sales Report*
| Region | 2023 | > | 2024 | > |
|:--{20%}|:--{20%}:|:--{20%}:|:--{20%}:|:--{20%}:|
| | Q3 | Q4 | Q1 | Q2 |
| North | 150.5 | 180.2 | 195.0 | 220.5 |
| South | 95.0 | 110.5 | 125.0 | 145.0 |
| ^ | | | | |

---



## Inline Markdown

| Feature | Status | Notes |
|---------|--------|-------|
| **Bold text** | Done | Works great |
| *Italic text* | Done | Renders correctly |
| `inline code` | Done | Monospace styled |
| ~~strikethrough~~ | Done | Line-through |

---

## Unicode & Emoji

| Status | Count | Trend |
|:------:|------:|:-----:|
| ✅ | 150 | 📈 |
| ⚠️ | 23 | ➡️ |
| ❌ | 3 | 📉 |

---

## Feature Matrix

| Feature | mrmd | GitHub | Obsidian |
|---------|:----:|:------:|:--------:|
| Basic tables | ✅ | ✅ | ✅ |
| Alignment | ✅ | ✅ | ✅ |
| Colspan | ✅ | ❌ | ❌ |
| Rowspan | ✅ | ❌ | ❌ |
| Column widths | ✅ | ❌ | ❌ |
| Decimal align | ✅ | ❌ | ❌ |
| Captions | ✅ | ❌ | ❌ |

---



## Syntax Reference

| Feature | Syntax | Example |
|---------|--------|---------|
| Caption above | `*text*` before table | `*Table 1: Title*` |
| Caption below | `*text*` after table | `*Source: data.gov*` |
| Column width | `{value}` in delimiter | `\|:--{30%}\|` |
| Colspan | `>` in cell | `\| Content \| > \|` |
| Rowspan | `^` in cell | `\| ^ \|` |
| Decimal align | `.` in delimiter | `\|---.\|` |





---

End of showcase.
