# Solution Architect Studio — แผนคร่าวๆ

สถานะ: **ร่างกำหนดขอบเขต ยังไม่มีการลงมือทำจริง**
Persona เจ้าของงาน: Yasmin Al-Rashid (`.claude/agents/solution-architect.md`)

## เป้าหมาย

ให้เครื่องมือกับวิศวกร (หรือ PM ที่กำลังร่างข้อเสนอ) ที่ agent `solution-architect`
สามารถแปลงชุด requirement/constraint หลวมๆ ให้กลายเป็นเอกสารออกแบบ architecture
โดย**มี diagram เป็นผลลัพธ์หลัก** ไม่ใช่แค่บทความที่บังเอิญพูดถึง diagram
Input คือบทสนทนาหรือ brief สั้นๆ ส่วน output คือเอกสารออกแบบที่มีเวอร์ชัน
(Markdown + diagram ที่ render แล้ว) ที่วิศวกรเอาไปให้ผู้ตรวจสอบ หรือใช้เป็นจุดเริ่มต้น
ของงาน Terraform/network จริงได้ เครื่องมือนี้เป็นแค่โครง (harness) รอบตัว agent —
ไม่ได้แทนที่วิจารณญาณของ Yasmin แต่ให้พื้นที่บันทึก constraint, สร้าง diagram ได้แน่นอน
และรักษาให้บทความกับ diagram ตรงกันเสมอเมื่อดีไซน์เปลี่ยนไป

## ขอบเขต V1: AWS อย่างเดียว, region เดียว, greenfield

เลือก **การออกแบบตามแนวทาง AWS Well-Architected** เป็นจุดเริ่ม แทนที่จะทำทั้ง 3 อย่าง
(Network / AWS / On-prem) แบบบางๆ พร้อมกัน:

- AWS มีคำศัพท์ที่เป็นมาตรฐานที่สุด (Well-Architected 6 pillars, VPC reference
  architecture) — สร้าง prompt ที่มีโครงสร้างและ diagram template ได้ง่ายที่สุด
- การออกแบบ Network และ on-prem ต้องพึ่ง constraint ทางกายภาพ/องค์กรที่ไม่ได้เขียนไว้
  ชัดเจนหลากหลายกว่ามาก (ฮาร์ดแวร์ที่มีอยู่, สัญญากับ carrier, ข้อกำหนด compliance)
  ซึ่งจับด้วยฟอร์ม input ทั่วไปได้ยากกว่า
- ทำแค่ AWS ก็ยังบังคับให้ต้องแก้ปัญหาส่วนที่ยากแบบทั่วไปอยู่ดี: การเก็บ constraint,
  การสร้าง diagram, โครงสร้างเอกสาร, ลูป review — สิ่งเหล่านี้ต่อยอดไปที่ Network/On-prem
  ใน V2 ได้โดยไม่ต้องทำซ้ำ

V1 เน้นให้ได้: AWS account เดียว, region เดียว, workload แบบ greenfield (ไม่ใช่ migration)
โดยผลลัพธ์คือ VPC/network diagram + เอกสาร trade-off แบบ Well-Architected สั้นๆ

## สิ่งที่ไม่ทำใน V1 (ชัดเจน)

- การออกแบบ AWS แบบ multi-region / multi-account Organizations
- โครงสร้าง on-premise หรือ hybrid (ไม่ทำโมเดล VPN/Direct Connect)
- Cloud อื่นที่ไม่ใช่ AWS (GCP, Azure)
- การประเมินต้นทุน / เครื่องคำนวณราคา
- การ generate โค้ด Terraform/IaC จากดีไซน์ (ทำแค่เอกสารออกแบบ ไม่ใช่ infra ที่รันได้จริง)
- ระบบ auth/multi-user สำหรับ review (V1 เป็น single-user, local-first)

หมายเหตุ: **การแก้ diagram สดผ่าน canvas ไม่ได้ถูกตัดออกแบบถาวร** — มันถูกเลื่อนไปเป็น
V1.1 (ดูด้านล่าง) ซึ่งจะทำทันทีหลังจาก loop "generate แล้ว render จาก source text"
ของ V1 ใช้งานได้แล้ว เหตุผลที่ไม่ใส่ใน V1 เอง: มันเพิ่ม editing surface ที่สอง (canvas),
JSON round-trip parser, และขั้นตอน reconciliation ระหว่าง diagram ที่ถูกแก้กับบทความ
— เป็นงานคนละก้อนกับ "agent ร่าง + render แบบกลไก" และ milestone ของ V1 เองก็ระบุ
ชัดว่า "ไม่ต้องแก้ diagram มือเลย" การปล่อย V1 ก่อนช่วยรักษาให้ชิ้นเล็กสุดที่ใช้งานได้ยัง
ตรงตามที่ตั้งไว้ ส่วน V1.1 ช่วยไม่ให้ feedback loop แบบ "คนวาดเอง" กลายเป็นเรื่อง
someday-maybe

## ส่วนประกอบหลัก

1. **การเก็บ constraint** — แบบฟอร์มสั้นๆ ที่มีโครงสร้าง (compliance, เพดานงบประมาณ,
   scale/RTO-RPO ที่คาดไว้, ข้อจำกัดที่มีอยู่) เป็นไฟล์ Markdown/YAML frontmatter
   ที่ผู้ใช้กรอกเองหรือบอก agent ให้เขียนให้ นี่คือ input ที่ persona ของ Yasmin
   บอกอยู่แล้วว่าเธอจะจดไว้ก่อนเสนอ topology — เครื่องมือแค่ให้มันมีที่อยู่ถาวรและ diff ได้
   แทนที่จะอยู่แค่ในแชท
2. **ขั้นตอนสร้างดีไซน์** — agent (ใช้ persona `solution-architect`) อ่านไฟล์ constraint
   แล้วร่าง: (ก) รายการ component และการตัดสินใจเรื่อง topology, (ข) หมายเหตุ trade-off
   ที่ชัดเจน ("เลือก X แทน Y เพราะ Z"), (ค) source ของ diagram (ดูด้านล่าง) ขั้นตอนนี้เป็น
   prompt/skill ไม่ใช่ infra ใหม่ — ไม่ต้องมี service ใหม่เพื่อ "รัน" มันนอกจากเรียก agent
3. **ขั้นตอน render diagram** — แปลง source text ของ diagram เป็นผลลัพธ์ที่ render แล้ว
   แยกเป็นขั้นตอนกลไกล้วนๆ (ไม่ใช่วิจารณญาณของ agent) เพื่อให้ diagram ยัง reproducible
   และ diff ได้ใน git
4. **ขั้นตอน output/review** — ประกอบ diagram ที่ render แล้ว + บทความ trade-off
   เป็นเอกสารออกแบบเดียว เก็บไว้ที่ `docs/` ของโปรเจกต์ (หรือที่ repo ปลายทางเก็บ ADR)
   โดยมีรูปแบบการตั้งชื่อที่แน่นอนเพื่อให้แก้ไขแบบ append-only ได้ง่าย (ตรงกับปรัชญา
   Oracle/Shadow "ไม่มีอะไรถูกลบ" — แทนที่ด้วยเวอร์ชันใหม่ ไม่ใช่เขียนทับ)

Flow คร่าวๆ: `constraints.yaml` → agent ร่าง `design.md` (topology + trade-off)
+ `diagram.mmd` → ขั้นตอน render ได้ `diagram.svg`/`.png` → ประกอบทั้งหมดเป็นเอกสารสุดท้าย
แต่ละ artifact เป็น plain text หรือรูปภาพ static ทั้งหมดจึง diff ได้ใน git โดยไม่ต้องมี
server/database สำหรับ V1

## แนวทางเรื่อง Diagram

**Mermaid** render ผ่าน `mmdc` (mermaid-cli) หรือ MCP tool `Mermaid_Chart`
ที่มีอยู่แล้วในสภาพแวดล้อมนี้ — เหตุผลสั้นๆ คือ source ของ Mermaid เป็น plain text
(diff ได้, agent เขียนเองได้, ไม่ต้องมี UI วาดรูป) และเรโปนี้มีเส้นทาง render Mermaid
ผ่าน MCP อยู่แล้ว ทำให้ V1 ไม่ต้องเพิ่ม infrastructure ใหม่เลย แนวคิดของ C4-model
(ระดับ context/container/component) ใช้เป็นกรอบจัดโครงสร้าง diagram Mermaid
แต่ไม่ใช้เครื่องมือเฉพาะของ C4 (PlantUML C4, Structurizr) ใน V1 — ชนิด diagram
`C4Context` ของ Mermaid ครอบคลุมระดับแรกได้เพียงพอแล้ว

## V1.1: การแก้ไข Diagram แบบ Round-Trip ผ่าน Canvas

ทำทันทีหลัง V1 เสร็จ วัตถุประสงค์: เมื่อคนไม่ชอบส่วนหนึ่งของ diagram ที่สร้างขึ้น
พวกเขาแก้ไขมันบน canvas โดยตรง แทนที่จะเขียน feedback เป็นบทความแล้วหวังว่า
การ regenerate จะได้ตรงตามที่ตั้งใจ

**Canvas ที่ใช้**: Excalidraw เหตุผลสั้นๆ — มี open-source path `@excalidraw/
mermaid-to-excalidraw` อยู่แล้ว ทำให้ `diagram.mmd` กลายเป็น scene ที่แก้ไขได้
โดยไม่ต้องสร้าง renderer ใหม่เลย เราไม่ได้ประเมิน canvas tool ตัวอื่นเพราะตัวนี้ปิด
ช่องว่างที่มีอยู่พอดี (Mermaid text ไม่มี drag-and-drop surface โดยธรรมชาติ)
โดยไม่ต้องเพิ่ม infra ใหม่ ตรงกับเหตุผลเดียวกับที่เลือก Mermaid ตั้งแต่แรก

**กลไก round-trip**: ขั้นตอนแปลงแบบกลไก (ไม่ใช่ LLM) อ่าน Excalidraw scene JSON
ที่ถูกแก้ไข แล้วดึงออกมาเป็นรายการ node/edge ที่มีโครงสร้างชัดเจน (label, การเชื่อม
shape-to-shape, bound text ที่ resolve แล้ว) — ใช้หลักการแบ่งงานเดียวกับที่ใช้กับ
Mermaid ("การ render/parse เป็นขั้นตอนกลไก ไม่ใช่วิจารณญาณของ agent") รายการ
ที่มีโครงสร้างนี้จะถูกเขียนกลับเป็น `diagram.mmd` ใหม่ ซึ่งยังคงเป็น source เดียว
ที่เป็นทางการและ diff ได้ (ตามหัวข้อแนวทางเรื่อง Diagram ด้านบน) agent จะไม่ parse
Excalidraw JSON ดิบโดยตรงเลย — เพราะ JSON นั้นมีพิกัด pixel, styling, และ field
เวอร์ชันภายในของ element ซึ่งเป็น noise สำหรับการให้เหตุผลเชิงความหมาย การป้อน
Mermaid text ที่ regenerate แล้วให้ agent ทำให้ input มีรูปแบบเดียวกับที่ agent
เข้าใจอยู่แล้ว และหลีกเลี่ยงการแตก "diagram ที่เป็นจริง" ออกเป็นสองรูปแบบที่แข่งกัน
(canvas JSON กับ `.mmd`)

**ตัวกระตุ้น**: อัตโนมัติ แต่เฉพาะเมื่อการแก้ไข "commit" แล้ว ไม่ใช่ทุกครั้งที่ลาก mouse
แม้แต่ pixel เดียว คำว่า "อัตโนมัติ" หมายถึง ขั้นตอนแปลง JSON-to-Mermaid แบบกลไก
และการคำนวณ diff/ข้อเสนอ reconciliation ทั้งคู่รันทุกครั้งที่มี edit-commit event
ที่ชัดเจน (เช่น deselect element, จบ edit session, หรือ state change ที่ชัดเจน
เทียบเท่ากันซึ่ง canvas เปิดให้ใช้อยู่แล้ว) — ไม่ใช่กลางการลากหรือทุกเฟรม เพราะขั้นตอนนี้
เป็นแบบกลไกและ deterministic (ขั้นตอนเดียวกับที่อธิบายไว้ข้างบน) ซึ่งราคาถูกและไม่มีเหตุผล
ต้องกั้นไว้หลังปุ่มกดเอง สิ่งที่ยังต้องให้คนกดยืนยันเองอยู่คือการ **ยอมรับ** ข้อเสนอแก้ไข
บทความใน `design.md` (ดู การ reconcile บทความ ด้านล่าง) — คนไม่ต้องกด "re-sync" อีกแล้ว
แต่ยังต้องกด "ยอมรับ" ก่อนที่บทความจะเปลี่ยนจริง

**การจัดการข้อขัดแย้ง**: การแก้ไขของมนุษย์ชนะเสมอ ถ้า diff ของ reconciliation พบว่า
diagram ที่แก้ไขขัดกับ constraint ที่ระบุไว้ใน `constraints.yaml` หรือหมายเหตุ trade-off
ที่มีอยู่ใน `design.md` (เช่น ย้าย DB ออกจาก private subnet ทั้งที่หมายเหตุ trade-off
เรื่อง Security สมมติไว้ว่ามันอยู่ใน private subnet) ระบบจะไม่ block, ไม่ปฏิเสธ, และไม่
revert การแก้ไขนั้นอัตโนมัติ — คนคือผู้มีอำนาจตัดสินใจสุดท้ายเหนือ diagram ข้อขัดแย้งนี้จะ
ถูกแสดงให้เห็นชัดในข้อเสนอ reconciliation ("การย้ายนี้ทำให้ DB ออกจาก private subnet
ซึ่งหมายเหตุ trade-off เรื่อง Security สมมติไว้ว่ามันอยู่") เพื่อไม่ให้ความไม่ตรงกันหายไปแบบ
เงียบๆ แต่ flag นี้เป็นข้อมูลเพื่อรับทราบเท่านั้น ไม่ใช่ด่านกั้นการแก้ไข

**การ reconcile บทความ**: การแก้ canvas เพียงอย่างเดียวจะ**ไม่**เขียนทับ `design.md`
แบบเงียบๆ ในทุกครั้งที่ reconciliation รันอัตโนมัติ agent จะ diff `diagram.mmd` เก่ากับที่
regenerate ใหม่, ระบุว่าข้อความ topology/trade-off ใน `design.md` ส่วนไหนอ้างอิงถึง
component ที่เปลี่ยนหรือถูกลบ (พร้อมแสดงข้อขัดแย้งใดๆ ตามด้านบน) แล้วเสนอส่วน
trade-off ที่อัปเดตให้คนกดยอมรับ — ไม่ใช่การเขียนทับอัตโนมัติแบบเงียบๆ เพราะ `design.md`
คือบันทึกแบบ ADR ว่า "ทำไม" ถึงตัดสินใจแบบนั้น มีแต่คนเท่านั้นที่ยืนยันได้ว่า component
ที่ย้ายไปแล้วยังตรงตามเหตุผลเดิมหรือไม่

**ประวัติการแก้ไข**: append-only ตามปรัชญา Oracle/Shadow "ไม่มีอะไรถูกลบ" ทุกครั้งที่มี
edit-commit event จะเพิ่มหนึ่งบรรทัดใน `diagram-history.jsonl` ซึ่งอยู่ข้างๆ `diagram.mmd`
ในโฟลเดอร์ output ของดีไซน์นั้น หนึ่ง JSON object ต่อหนึ่งบรรทัด:
`{"timestamp": "<ISO8601>", "diagram_diff": "<node/edge ที่เพิ่ม ลบ หรือย้าย>", "conflicts_flagged": ["<constraint หรือ trade-off note ที่ขัดแย้ง ถ้ามี>"], "prose_reconciliation_status": "proposed|accepted|rejected"}`
บรรทัดก่อนหน้าไม่ถูกเขียนทับหรือลบเลย — การแก้ไขครั้งใหม่แค่เพิ่มบรรทัดใหม่ ไม่แตะบรรทัด
เดิม ส่วน `diagram.mmd` เองยังเป็นไฟล์เดียวที่ live และถูกเขียนทับในที่เดิมทุกครั้ง (มันคือ
source ที่เป็นทางการปัจจุบัน ไม่ใช่ version chain) แต่ `diagram-history.jsonl` คือ timeline
ที่คงอยู่และค้นหาได้ของทุกการแก้ไขและสิ่งที่ agent เสนอหรือคนยอมรับ/ปฏิเสธ

## คำถามสำคัญที่ต้องให้คนตัดสินใจก่อนทำต่อ

- เอกสารออกแบบจะ "อยู่" ที่ไหนหลังสร้างเสร็จ — อยู่ใน monorepo นี้ (เช่น
  `projects/solution-architect-studio/output/`) หรือเครื่องมือเขียนเข้า repo ปลายทาง
  ที่ดีไซน์นั้นเป็นของ? เรื่องนี้เปลี่ยนไปว่า V1 ต้องมีความสามารถเขียนข้าม repo หรือไม่เลย
- นี่ควรเป็น CLI (`bun run design ...`) ที่เรียกเป็นครั้งๆ ไป, slash-command/skill
  ที่วางทับ agent เดิม, หรือ HTTP service เล็กๆ ที่มี route ของตัวเอง? มีผลว่า
  convention ของ Bun/Elysia เกี่ยวข้องด้วยหรือไม่ หรือจริงๆ แล้วใกล้เคียงกับ skill + agent
  persona ที่ไม่มี server เลย
- การเก็บ constraint ควรเป็นฟอร์ม (ไฟล์ที่มีโครงสร้างให้คนแก้เอง) หรือเป็นการสนทนาที่
  agent รันแล้ว serialize ออกมาเอง? มีผลว่า V1 ต้องมี UI หรือไม่
- "review" หมายถึงคนอ่าน Markdown เฉยๆ หรือต้องมีกลไก diff/approve (เช่นผ่าน PR)
  สำหรับ V1 ด้วยไหม?
- รูปแบบเวอร์ชัน/การตั้งชื่อเอกสารออกแบบเมื่อ constraint เปลี่ยน — แทนที่ไฟล์เดิม
  (`design-v2.md`) หรือไฟล์เดียวที่พัฒนาไปเรื่อยๆ พร้อมส่วน changelog?

(การจัดการข้อขัดแย้ง, ประวัติการแก้ไข, และความละเอียดของตัวกระตุ้น reconciliation
สำหรับการแก้ diagram ผ่าน canvas ใน V1.1 เคยเป็นคำถามค้างอยู่ตรงนี้ — ตอนนี้ทั้งสามข้อ
ตัดสินใจแล้ว ดูส่วนกลไก V1.1 ด้านบนสำหรับรายละเอียดการตัดสินใจ)

## Milestone แรก ("เสร็จ" สำหรับชิ้นเล็กสุดที่ใช้งานได้)

จากไฟล์ `constraints.yaml` ที่กรอกครบสำหรับ workload AWS แบบ greenfield 1 ชิ้น
(เช่น "public web app + RDS ต้อง HA ภายใน region เดียว งบจำกัด") การรันเครื่องมือ
ต้องได้ผลลัพธ์โดยไม่ต้องแก้ diagram มือเลย:

1. `design.md` — การตัดสินใจเรื่อง topology + ส่วน trade-off ที่อ้างอิงอย่างน้อย
   pillar Reliability และ Cost Optimization อย่างชัดเจน
2. `diagram.mmd` — diagram VPC/network แบบ Mermaid (subnet, AZ, managed service สำคัญ)
   ที่ `design.md` อ้างอิงถึง
3. `diagram.svg` ที่ render จาก source นั้น ดูได้โดยไม่ต้องเปิด Mermaid editor

สำเร็จ = คนที่สองที่ไม่รู้เรื่อง request นี้มาก่อน อ่าน `design.md` + diagram แล้วเข้าใจว่า
ตัดสินใจอะไรไปและทำไม โดยไม่ต้องถาม agent เพิ่มเรื่อง topology เอง (คำถามเรื่อง
process/tooling ยังค้างไว้ได้ ไม่เป็นไร)

## Milestone V1.1 ("เสร็จ" สำหรับชิ้นเล็กสุดของการแก้ diagram ผ่าน canvas)

จาก output ของ V1 ที่มีอยู่แล้ว (`design.md` + `diagram.mmd` + `diagram.svg`)
คนเปิด diagram ใน Excalidraw ย้าย box หนึ่งกล่อง (เช่น ย้าย RDS instance ออกจาก
private subnet group) และ/หรือแก้ label ของมัน แล้ว deselect (จบการแก้ไข —
ไม่ต้องกด re-sync เอง) สำเร็จเมื่อ:

1. `diagram.mmd` ถูก regenerate อัตโนมัติจาก scene ที่แก้แล้ว และสะท้อน component
   ที่ย้าย โดยไม่มี node/edge อื่นหายหรือเสียหาย
2. มีบรรทัดใหม่ถูกเพิ่มใน `diagram-history.jsonl` บันทึก timestamp และสรุป diff
   ของการแก้ไขนั้น
3. ส่วน trade-off ใน `design.md` ได้รับข้อเสนอแก้ไข (ไม่ใช่การใส่ให้อัตโนมัติแบบเงียบๆ)
   ที่อ้างอิงตำแหน่งใหม่ของ component ที่ย้าย — ไม่ปล่อยให้ค้างชี้ topology เก่าแบบเงียบๆ
   และคนต้องกดยอมรับก่อนที่บทความจะเปลี่ยนจริง
4. ถ้าการย้ายขัดกับ constraint หรือหมายเหตุ trade-off ที่มีอยู่ ข้อขัดแย้งนั้นจะปรากฏ
   ในข้อเสนอ — ไม่ block การแก้ไขนั้นเอง
5. ส่วนอื่นของ `design.md` ไม่เปลี่ยนแปลง — ขั้นตอน reconciliation แตะแค่บทความที่
   เกี่ยวกับ component ที่แก้ ไม่ใช่การ regenerate เอกสารทั้งหมดใหม่แบบไม่เกี่ยวข้องกัน
