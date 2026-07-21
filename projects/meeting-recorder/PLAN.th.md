# Meeting Recorder — แผนคร่าวๆ (v0.1 กำหนดขอบเขตเท่านั้น)

Persona เจ้าของงาน: Tomás Reyes (`.claude/agents/meeting-recorder-engineer.md`)
นี่คือ sub-project ที่อยู่ใต้ `projects/meeting-recorder/` — เป็นตัวของตัวเอง
(มี `package.json`, README ของตัวเอง) แบบเดียวกับ `web-shop/` ยังไม่เชื่อมเข้ากับ
server/MCP หลักของ arra-oracle จนกว่าเฟสถัดไปจะตัดสินใจว่าควรทำ

## เป้าหมาย

สำหรับทีมที่ใช้ทั้ง Zoom/Meet/Teams ผสมกับประชุมแบบพบหน้า ให้มีที่เดียวที่ได้ทั้ง
บันทึกเสียง + transcript/สรุปที่ค้นหาได้ โดยไม่ต้องกดเริ่ม/หยุดอัดเอง หรือ copy-paste
transcript ออกจาก UI ของแต่ละแพลตฟอร์มเอง งานที่ต้องทำ: จับเสียง (ไม่ว่าประชุมจะเกิด
ที่ไหน), แปลงเป็น transcript พร้อมระบุผู้พูด, เก็บไว้ในที่ที่ควบคุมสิทธิ์เข้าถึงได้,
และลบทิ้งตามกำหนดเวลาที่มีคนตัดสินใจไว้จริงๆ

## ขอบเขต V1

**Zoom ผ่าน cloud-recording webhook export — ไม่ใช่ bot-join**

เหตุผล: ฟีเจอร์ Cloud Recording ของ Zoom + webhook `recording.completed` เป็นเส้นทาง
export ที่เป็นผู้ใหญ่ที่สุด มีเอกสารชัดเจนที่สุด และสะอาดเรื่อง ToS ที่สุดในสามแพลตฟอร์ม
อีกทั้งไม่ต้องมี bot เข้าร่วมประชุมในฐานะผู้เข้าร่วมปลอมเลย ความเสี่ยงด้านวิศวกรรม +
นโยบายต่ำสุดสำหรับชิ้นแรก

ส่วนที่เหลือ — Meet, Teams, bot-join ของแพลตฟอร์มใดก็ตาม, และการจับเสียงแบบ offline —
เลื่อนออกไปอย่างชัดเจน (ดูด้านล่าง) การจับเสียงแบบ offline น่าจะเป็นชิ้น V1.1 ถัดจากนี้
เพราะมันช่วยพิสูจน์ pipeline transcription/diarization/storage ได้โดยไม่ขึ้นกับความ
แปลกประหลาดของ API แพลตฟอร์มไหนเลย

## สิ่งที่ไม่ทำใน V1 (ชัดเจน)

- การเชื่อมต่อ Google Meet และ Microsoft Teams (auth คนละแบบ — Meet ต้อง Workspace
  admin consent, Teams ต้อง Graph app registration + admin consent — แต่ละอันเป็น
  โปรเจกต์ขนาดใหญ่ของตัวเอง ไม่ใช่แค่ variant ของ Zoom)
- การจับด้วย bot-join บนแพลตฟอร์มใดก็ตาม (เข้าร่วมเป็นผู้เข้าร่วมที่เห็น/ไม่เห็นเพื่อจับ
  เสียงสด) — failure mode ต่างจาก webhook export (bot โดนเตะ, ค้างใน waiting room,
  ถูกตรวจจับและบล็อก) ตั้งใจไม่ผสมเข้ากับ V1
- การจับเสียง/diarization แบบ offline — เป็น pipeline จริงแต่ไม่ใช่อันดับแรก
- Transcription แบบ real-time/streaming — V1 เป็นแบบ batch คือรอไฟล์บันทึกเสร็จก่อน
  ค่อย transcribe
- การเชื่อมปฏิทิน / ตั้งเวลาบันทึกอัตโนมัติ
- UI ใดๆ นอกจากที่จำเป็นสำหรับดู transcript (เช่นหน้า list/detail เปล่าๆ) — ไม่มี
  frontend ที่ขัดเงาใน V1
- รองรับหลายองค์กร (multi-tenant) — เริ่มที่ Zoom account เดียวก่อน

## ส่วนประกอบหลัก

1. **การจับข้อมูล — online (ตัว adapter ของ Zoom สำหรับ V1)**
   ลงทะเบียนแอป Zoom Server-to-Server OAuth, subscribe webhook `recording.completed`
   และเมื่อรับ webhook แล้วดาวน์โหลดไฟล์บันทึก (เสียง/วิดีโอ + transcript แบบ VTT ของ
   Zoom เองถ้ามี) ผ่าน download URL ที่ต้อง authenticate ไม่มี bot ไม่มีการเชื่อมต่อสด
   กับตัวประชุมเลย

2. **การจับข้อมูล — offline (เลื่อนออกไป แต่เป็นส่วนหนึ่งของสถาปัตยกรรมเป้าหมาย)**
   จับเสียงจาก mic + system-audio ในเครื่อง (เฉพาะแต่ละ OS: macOS ใช้
   ScreenCaptureKit/CoreAudio tap ส่วน Linux/Windows ใช้วิธีอื่น) บวกกับ speaker
   diarization เพราะไม่มีช่องแยกเสียงผู้พูดจากแพลตฟอร์มให้สำหรับห้องประชุมจริง
   ต้องมองเป็น code path ที่แยกออกจากข้อ (1) จริงๆ ไม่ใช่แค่แตกกิ่งจากมัน —
   trigger ต่างกัน (กดเริ่ม/หยุดเอง หรือผูกกับปฏิทิน ไม่ใช่ webhook), failure mode
   ต่างกัน, พื้นที่ privacy ต่างกัน (mic ที่เปิดอยู่ในห้องจริง เทียบกับ asset บน cloud
   ที่ดึงผ่าน API)

3. **Storage**
   Object storage สำหรับไฟล์บันทึกดิบ (เสียง/วิดีโอ) + แถวข้อมูล metadata ต่อการประชุม
   1 ครั้งในฐานข้อมูล (แพลตฟอร์มต้นทาง, ผู้เข้าร่วมถ้ารู้, ระยะเวลา, path การเก็บ,
   วันหมดอายุตาม retention, access-control list) แยกเก็บ media ดิบกับข้อความ transcript
   คนละที่ เพื่อให้การลบ/ทำลายเสียงดิบที่อ่อนไหวทำได้อิสระจากการเก็บ (หรือ redact)
   transcript ต่อไป

4. **Transcription / Diarization**
   V1: ใช้ transcript แบบ VTT ที่ Zoom สร้างให้เองถ้ามี (เร็ว ฟรี ไม่ต้องมี pipeline
   เพิ่ม) ถ้า Zoom ไม่ได้สร้างให้ก็ fallback ไปใช้บริการ ASR (เช่น Whisper)
   Diarization จาก cloud recording ของ Zoom โดยทั่วไปอ่อนหรือไม่มีเลยสำหรับ VTT export —
   ตั้งใจระบุไว้ว่าเป็นช่องโหว่ที่รู้อยู่แล้ว ไม่ได้แก้ใน V1 ขั้นตอนตรวจทาน/แก้ไขโดยคน
   เป็น TODO ที่ต้องทำเอง ยังไม่ได้สร้างไว้

5. **นโยบาย Retention & Access (เป็น component จริงจัง ไม่ใช่ของแถม)**
   การบันทึกทุกอันที่เก็บไว้ต้องมี: ใครดูได้ (ACL ไม่ใช่ "ทุกคนที่เข้าถึง repo ได้"),
   วันหมดอายุตาม retention ที่ตั้งไว้ตอน ingest (ไม่ใช่มาตัดสินใจทีหลัง), และ job ลบ
   ที่รันตามกำหนดเวลาจริง เรื่องนี้ต้องมีการตัดสินใจเชิงนโยบายก่อนเก็บบันทึกใดๆ
   นอกเหนือจาก local dev sandbox — ดูคำถามเปิดด้านล่าง ไม่ควรมีการบันทึกใดถูกเขียนลง
   storage โดยไม่มีฟิลด์เหล่านี้ครบ แม้แต่ใน V1

## Zoom V1 — API ทำอะไรได้จริง (ต้อง verify ก่อนลงมือ)

ความเข้าใจปัจจุบัน **ยังไม่ได้ verify กับเอกสาร Zoom ล่าสุด — ต้องยืนยันก่อนเขียนโค้ด**:

- **Cloud Recording** ของ Zoom (ฟีเจอร์ในแผนแบบเสียเงิน) อัปโหลดบันทึกการประชุมขึ้น
  cloud ของ Zoom อัตโนมัติหลัง host จบการประชุม สร้างไฟล์เสียง/วิดีโอ/แชท/transcript
- แอป **Server-to-Server OAuth** (Zoom Marketplace) subscribe webhook event
  `recording.completed` ได้ ซึ่งจะยิงมาพร้อม download URL (แต่ละอันต้องใช้
  access token ของแอป) ของไฟล์บันทึก รวมถึงไฟล์ transcript `.vtt` ถ้าเปิด
  auto-transcription ไว้ในบัญชี นี่คือเส้นทาง "webhook-based cloud-recording export" —
  ไม่มี bot ไม่มีการเชื่อมต่อสด
- Bot-join (ผู้เข้าร่วมสังเคราะห์ที่เข้าผ่าน meeting SDK ของ Zoom เพื่อจับ stream
  เสียง/วิดีโอดิบ) เป็นการเชื่อมต่อแยกที่หนักกว่า (Zoom SDK/RTMS) มีเรื่อง approval
  และ ToS ของตัวเอง ตั้งใจไม่ใช้ใน V1
- สิ่งที่ต้อง verify ก่อนเริ่มลงมือ:
  - ยืนยันชื่อ/รูปแบบ payload ของ webhook event ปัจจุบัน และรูปแบบ auth ของ
    download URL (Zoom เคยเปลี่ยนการ validate webhook มาก่อน เช่น CRC/challenge
    handshake)
  - ยืนยันว่า Cloud Recording + auto-transcription ต้องใช้ Zoom plan tier ระดับไหน
    สำหรับบัญชีเป้าหมาย
  - ยืนยันช่วงเวลาหมดอายุของ download URL (pipeline ต้องดึงไฟล์เร็วแค่ไหนหลัง
    webhook ยิงมา)

## คำถามสำคัญที่ต้องให้คนตัดสินใจ

- **Consent/compliance**: ต้องบอกใครบ้างว่าประชุมกำลังถูกบันทึก และบอกยังไง
  (แจ้งด้วยเสียง, banner ในห้องประชุม, นโยบายก่อนประชุม)? เขตอำนาจศาลมีผล
  (region ที่ต้องขอความยินยอมฝ่ายเดียวหรือทั้งสองฝ่าย) — เรื่องนี้ block การจับเสียง
  แบบ offline เป็นพิเศษ เพราะไม่มีการแจ้งเตือน "กำลังบันทึก" จากแพลตฟอร์มให้พึ่งพา
- **Transcript เก็บไว้ที่ไหน** — ใช้ storage/DB เดิมของเรโปนี้ (เช่นใช้ pattern
  Drizzle/SQLite ที่มีอยู่แล้วใน `src/db/`) หรือแยก service/data store เต็มรูปแบบ
  เพราะเนื้อหาประชุมอ่อนไหวแค่ไหน?
- **ระยะเวลา retention** — 30/90/365 วัน? ต่างกันตามประเภทประชุม (1:1 เทียบกับ
  all-hands)? ใครอนุมัติการลบก่อนกำหนด หรือกรณี legal-hold?
- **ใครเข้าถึงได้โดย default** — แค่ host/organizer ของประชุม, ผู้เข้าร่วมทุกคนที่ถูก
  เชิญ, หรือ role admin เฉพาะ? ต้องเพิกถอนสิทธิ์เข้าถึงเป็นรายคนย้อนหลังได้ไหม?
- **Runtime สำหรับ agent จับเสียง offline**: Bun เป็นค่า default ของเรโป แต่ native
  API สำหรับจับ mic/system-audio ขึ้นกับ OS (Swift/CoreAudio บน macOS, WASAPI บน
  Windows) — binary สำหรับจับเสียง offline อาจต้องเป็น native helper เล็กๆ
  (Swift/Rust) ที่ถูกเรียกโดย orchestrator ที่ใช้ Bun แทนที่จะเป็น Bun ล้วนๆ
  บอกไว้ตั้งแต่ตอนนี้เพื่อไม่ให้ถูกมองข้ามทีหลัง ส่วนชิ้น online/Zoom V1 ไม่มีข้อจำกัด
  แบบนี้ (Bun HTTP service ธรรมดาพอสำหรับ webhook + download + เรียก ASR)

## Milestone แรก ("เสร็จ" สำหรับชิ้นแรกสุด)

ลงทะเบียนแอป Zoom Server-to-Server OAuth กับบัญชี Zoom ทดสอบ 1 บัญชี; จบการประชุม
ทดสอบจริงที่เปิด Cloud Recording ไว้แล้ว trigger webhook `recording.completed`;
service ดาวน์โหลดเสียง + transcript VTT (หรือ fallback ไป Whisper ถ้าไม่มี VTT)
เขียนทั้งคู่ลง object storage + แถวข้อมูลในฐานข้อมูลที่มีฟิลด์ retention-expiry
และ ACL ครบ (แม้ ACL จะเป็นแค่ "user คนเดียวที่ hardcode ไว้" ตอนนี้ก็ได้) และมีคน
ดึง transcript ของการประชุมนั้นมาอ่านได้ครบ end-to-end ไม่ต้องมี UI นอกจากคำสั่ง CLI
หรือ endpoint JSON เดียวสำหรับดึงข้อมูล
