# Project Documentation Map

> Project: arra-oracle-v3
> Last Updated: 2026-05-05
> CMMI Target: Level 3 (Defined)

## Compliance Documents

| Document | Standard | Update When |
|----------|----------|-------------|
| [SRS.md](SRS.md) | ISO/IEC/IEEE 29148 | requirement ใหม่หรือ behavior เปลี่ยน |
| [SDD.md](SDD.md) | IEEE 1016 | architecture หรือ implementation contract เปลี่ยน |
| [UAT.md](UAT.md) | IEEE 829 | scenario ใหม่, bug fix, regression, release gate |
| [RTM.md](RTM.md) | Traceability | ทุก requirement ที่โยงกับ code/QA/PR |

## Technical Documents

| Document | Description |
|----------|-------------|
| [architecture.md](architecture.md) | System architecture overview |
| [API.md](API.md) | API endpoint reference |
| [INSTALL.md](INSTALL.md) | Installation guide |
| [LOCAL-DEV.md](LOCAL-DEV.md) | Local development setup |
| [SPEC-original.md](SPEC-original.md) | Original specification |

## Rules

- Markdown เป็น source of truth; DOCX/PPTX/XLSX เป็น export artifact เมื่อมีคำสั่งเท่านั้น
- Diagram ใช้ Mermaid code blocks เท่านั้น ห้ามไฟล์ภาพแยก
- user-facing PR ต้อง update docs ใน PR เดียวกัน
