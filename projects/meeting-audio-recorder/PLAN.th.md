# Meeting Audio Recorder — แผน (v0.1 กำหนดขอบเขตเท่านั้น)

Persona เจ้าของงาน: Tomás Reyes (`.claude/agents/engineering/meeting-recorder-engineer.md`)
นี่คือ sub-project **ที่แยกออกมาต่างหากจาก** `projects/meeting-recorder/`
(โปรเจกต์ Zoom webhook/cloud-recording) — ไม่มีโค้ดร่วมกัน ไม่มี DB ร่วมกัน
ไม่มี runtime ร่วมกัน ขอบเขตที่มนุษย์ระบุชัดเจน: "เอาแค่อัดเสียงพอ" ไม่มี
transcription ไม่มี cloud ไม่มีเชื่อมต่อ API ของแพลตฟอร์มไหนเลย ไม่มี diarization
ไม่มี AI processing ใดๆ ทั้งสิ้น เอกสารนี้เป็นการวางแผนเท่านั้น — ยังไม่มีอะไรถูกสร้าง

## เป้าหมาย

คนคนเดียว (คุณ บนเครื่อง Mac นี้) อยากบันทึกเสียงประชุม Zoom/Meet/Teams, webinar,
หรือ session ใดๆ ที่มีเสียงในเครื่องตัวเอง โดยจับทั้งเสียงตัวเองและเสียงอีกฝ่าย
ที่ออกมาทางลำโพง — โดยไม่ต้องพึ่งฟีเจอร์บันทึกของแพลตฟอร์มไหนเลย (ซึ่ง host อาจปิดไว้,
อาจถูกล็อกไว้เฉพาะแผนเสียเงิน, หรือแค่ไม่น่าไว้ใจว่าจะเก็บสำเนาในเครื่องให้จริงๆ)
และไม่ต้องส่งอะไรออกไป cloud เลย งานนี้แคบโดยตั้งใจ: กดปุ่มลัดครั้งเดียว, อยู่ในประชุม,
กดอีกครั้ง, ได้ไฟล์เสียง แค่นั้น ไม่มีอย่างอื่น

## แนวทางการจับเสียง

**การตัดสินใจ: ใช้ ScreenCaptureKit สำหรับ system audio และ `AVAudioEngine`
สำหรับไมค์ — ไม่ใช้ BlackHole หรือ virtual-loopback driver อื่น**

เหตุผล:

- Apple เพิ่มการจับ system audio เข้าไปใน `ScreenCaptureKit` ตั้งแต่ macOS 13
  (`SCStream` พร้อม `SCStreamConfiguration` แบบ audio-only หรือ audio+video)
  โดยตั้งใจให้แอปไม่ต้องพึ่ง virtual audio device เพื่อ "ได้ยินสิ่งที่ลำโพงกำลังเล่น"
  อีกต่อไป เครื่องนี้รัน macOS 26.3 ซึ่งเกินเกณฑ์นั้นไปมาก
- แนวทางแบบ BlackHole (ติดตั้ง virtual audio driver, ตั้งเป็น system output,
  route output จริงผ่านมันด้วย Multi-Output Device หรือ Loopback Audio) ใช้ได้กับ
  macOS ทุกเวอร์ชัน แต่มีต้นทุนจริงที่โปรเจกต์นี้ไม่จำเป็นต้องจ่าย: การติดตั้ง
  kernel/audio-driver ของบุคคลที่สามนอกเหนือ API ที่ Apple รับรอง, ขั้นตอนตั้งค่า
  Audio MIDI Setup ด้วยมือที่มนุษย์ต้องทำซ้ำถ้ามันพังเมื่อไหร่, และผลข้างเคียงถาวรต่อ
  การ routing เสียงทั้งเครื่อง (output ของทุกแอปวิ่งผ่าน virtual device ไม่ใช่แค่
  แอปที่กำลังถูกบันทึก) ซึ่งยังอยู่แม้ tool นี้จะไม่ได้รันอยู่ก็ตาม
- การจับ audio ของ ScreenCaptureKit ไม่ต้องเปลี่ยน audio routing ของระบบเลย —
  มัน tap เสียงที่ผสมแล้วโดยตรงผ่าน API first-party ของ Apple โดยมี Screen
  Recording TCC permission เป็นด่านเดียว (ขอครั้งเดียว) และมีผลแค่ตอนที่ตัว
  recorder รันอยู่จริงเท่านั้น แอปอื่นไม่มีอะไรเปลี่ยน
- Trade-off ที่รับทราบ: audio-only path ของ ScreenCaptureKit ยังต้องตั้ง `SCStream`
  กับ `SCContentFilter` (scope เป็น display หรือ running-app) แม้จะไม่ต้องการ
  video frame เลยก็ตาม — video frame แค่ถูกทิ้ง (หรือจับที่ขนาดเล็กสุด) เพื่อ
  ประหยัด CPU/memory เป็นแค่ quirk เล็กๆ ของ implementation ไม่ใช่เหตุผลให้เลี่ยง
  framework นี้
- การจับไมค์ไม่เกี่ยวกับ system audio เลย ใช้เส้นทางมาตรฐานธรรมดา:
  `AVAudioEngine` tap ที่ default input node (หรือ `AVCaptureDevice` เจาะจงถ้า
  มนุษย์อยากเลือกไมค์เองในอนาคต) ไม่มีดราม่าการตัดสินใจตรงนี้

**ตัดสินแล้ว: ไม่ต้องกันเสียง output ของตัวเอง** `SCStream` รองรับการ exclude
เสียงของแอปเจาะจงออกจากสิ่งที่จับได้ ซึ่งจะมีความหมายก็ต่อเมื่อ tool นี้ทำเสียงเอง
แต่มันไม่ทำ — เป็น background CLI process เงียบๆ ไม่มีเสียง chime ตอน
start/stop ไม่มี notification sound ไม่มีอะไรให้กัน นี่คือ "ไม่เกี่ยวข้อง"
ไม่ใช่ "เลื่อนออกไป" ถ้าเวอร์ชันในอนาคตเพิ่มเสียง feedback ใดๆ (เช่น chime
ตอน start/stop) แอปที่ทำเสียงนั้นจะต้องถูกเพิ่มเข้า `SCContentFilter`
exclusion list ตอนนั้น — ระบุไว้เพื่อไม่ให้ลืม ไม่ใช่เพราะเกี่ยวข้องตอนนี้

## Output: format, โครงสร้างไฟล์, การตั้งชื่อ

**การตัดสินใจ: ไฟล์ WAV แยกอิสระ 2 ไฟล์ต่อ session (`mic.wav`, `system.wav`)
บวกกับ `combined.wav` แบบ 2 channel ที่สร้างอัตโนมัติด้วยการเรียก `ffmpeg`
ตอน stop — ไม่ใช่การ mix/sum แบบ real-time ในตัว Swift capture process**

เหตุผล:

- การจับไมค์ (`AVAudioEngine`) กับการจับ system audio (`SCStream`) เป็น producer
  อิสระ 2 ตัวที่มี callback cadence, buffer size, และ (อาจจะ) sample rate ต่างกัน
  การเขียนแต่ละตัวลงไฟล์ของตัวเองทันทีที่ buffer มาถึงเป็น implementation ที่ถูกต้อง
  ที่ง่ายที่สุด — ไม่ต้อง resample, ไม่ต้องมี shared ring buffer, ไม่มีความเสี่ยงที่
  source หนึ่งจะ block หรือทำอีก source เสียหายถ้ามันสะดุด
- การ mix แบบ real-time (บวกสัญญาณทั้งสองเข้าด้วยกันเป็น mono/stereo ตอนเสียงมาถึง)
  คืองานประเภท "generalize ก่อนที่จะมีเวอร์ชันที่ใช้งานได้จริงตัวแรก" ที่มนุษย์บอก
  ชัดเจนว่ายังไม่ต้องการ มันยังเสี่ยง clipping ตอนทั้งสองฝ่ายพูดพร้อมกัน ซึ่งไฟล์
  แยก 2 ไฟล์ไม่มีปัญหานี้เลย
- ยังมีไฟล์เดียวสำหรับความสะดวก แต่เป็น **ขั้นตอนหลังการบันทึก** ไม่ใช่ real-time:
  ตอน session หยุด รันคำสั่ง `ffmpeg` หนึ่งคำสั่งที่ channel-merge (ไม่ใช่ sum)
  ไฟล์ทั้งสองเป็น `combined.wav` แบบ 2 channel — ไมค์อยู่ channel ซ้าย, system
  audio อยู่ channel ขวา ทั้งสองฝั่งยังฟังชัดแยกกันได้ (ไม่มี clipping จากการ sum)
  และมนุษย์ยังได้ "ไฟล์เดียว" สำหรับแชร์หรือเปิดฟัง ตอบโจทย์จริงโดยไม่ต้องสร้าง
  logic การ sync เข้าไปใน capture path เอง
- `ffmpeg` ติดตั้งอยู่แล้วบนเครื่องนี้ (`/opt/homebrew/bin/ffmpeg`) ดังนั้นไม่ได้
  เพิ่ม dependency ใหม่ที่ต้องไปตั้งค่าเลย

**ตัดสินแล้ว: ยืนยันว่าคุ้มที่จะทำ** `combined.wav` ยังอยู่ในแผนตามที่ออกแบบไว้
ข้างบนเป๊ะๆ — สร้าง *เพิ่มเติมจาก* `mic.wav` กับ `system.wav` ไม่ใช่แทนที่มัน
ไฟล์ดิบทั้งสองยังอยู่บนดิสก์เสมอ เพื่อไม่ให้เสียอะไรไปถ้าขั้นตอน merge เองพัง
หรือต้องรันใหม่ด้วย option อื่น

ตำแหน่งไฟล์และการตั้งชื่อ:

- `~/Documents/MeetingRecordings/<YYYY-MM-DD_HHMMSS>/` — โฟลเดอร์แบบ timestamp
  หนึ่งอันต่อ session การบันทึก สร้างตอนเริ่มบันทึก
- ข้างใน: `mic.wav`, `system.wav`, `combined.wav`
- ไม่มี metadata DB, ไม่มี ACL, ไม่มี retention job — นี่คือ single-user, local-only
  และ "storage layer" ทั้งหมดคือแค่ไฟล์ในโฟลเดอร์ (ต่างจาก storage component ของ
  `projects/meeting-recorder/` ซึ่งเป็น tool ที่หนักกว่าสำหรับงานคนละแบบโดยตั้งใจ)

## กลไกควบคุม

**การตัดสินใจ: ใช้ pattern `toggle.sh` + Automator Quick Action + global keyboard
shortcut จาก `projects/voice-to-terminal/` ซ้ำ** เพราะพิสูจน์แล้วว่าใช้งานได้จริง
บนเครื่องนี้ (logic toggle ด้วย PID file แบบเดียวกัน, บทเรียนเดียวกันที่ได้เรียนรู้
มาแล้วเรื่อง "ไม่มี console ให้เห็นตอนรันผ่าน Services menu เลยต้อง log ลงไฟล์แทน")

- Swift command-line binary เล็กๆ (เช่น `record-meeting`) ทำหน้าที่จับเสียงจริง:
  เปิด `SCStream` สำหรับ system audio, เริ่ม `AVAudioEngine` tap สำหรับไมค์,
  เขียนทั้งคู่ลง `AVAudioFile` ใต้โฟลเดอร์ของ session และตอนโดน `SIGTERM` ปิด
  ไฟล์ทั้งสองอย่างเรียบร้อย
- `toggle.sh` (bash, รูปแบบเดียวกับตัว voice-to-terminal) ทำแค่ process
  management: มีการบันทึกที่รันอยู่แล้วไหม (PID file)? ถ้าไม่มี สร้างโฟลเดอร์
  timestamp แล้ว launch `record-meeting` เป็น background ถ้ามี ก็ `SIGTERM` มัน,
  รอให้ออกแบบ clean แล้วรันคำสั่ง `ffmpeg` merge หนึ่งคำสั่งเพื่อสร้าง `combined.wav`
- ผูกกับ global keyboard shortcut ผ่าน Automator Quick Action + System Settings >
  Keyboard Shortcuts > Services แบบเดียวกับที่มีเอกสารไว้แล้วใน
  `projects/voice-to-terminal/README.md`

การตัดสินใจเรื่อง language/runtime: **Swift** สำหรับ capture binary ไม่ใช่
Bun/Node/Python `ScreenCaptureKit` และ `AVAudioEngine` เป็น framework first-party
ของ Apple ที่ไม่มี binding อย่างเป็นทางการสำหรับ runtime อื่นบนเครื่องนี้
การพยายามขับมันจาก Bun หมายถึงต้องเขียนโค้ด Swift/Obj-C bridge แบบเดียวกันนี้อยู่ดี
แค่อยู่หลังชั้น FFI โดยไม่ได้ประโยชน์อะไรเพิ่ม ตรงกับคำถามเปิดที่ระบุไว้แล้วใน
`projects/meeting-recorder/PLAN.md` (native helper + shell/Bun orchestrator) —
โปรเจกต์นี้แค่ตัดสินใจแก้ปัญหานั้นตรงๆ เพราะไม่มี runtime อื่นที่ต้อง reconcile ด้วย

## Disk space safety

**ข้อกำหนดใหม่ (ตัดสินแล้ว): ต้องมีระบบเตือนดิสก์เต็มจริงๆ ไม่ใช่ปล่อยให้ล้มเหลว
แบบเงียบๆ**

อยู่ใน Swift binary `record-meeting` เอง ไม่ใช่ `toggle.sh` — เพราะมันเป็น
เจ้าของ write loop และ file handle อยู่แล้ว จึงเป็นที่เดียวที่ตอบสนองต่อพื้นที่
ต่ำได้ *ก่อน* การเขียนจะล้มเหลว และเป็นที่เดียวที่ปิดไฟล์ให้เรียบร้อยแทนที่จะ
ปล่อยให้ไฟล์ค้างครึ่งๆ กลางๆ `toggle.sh` ยังคงทำแค่ process management และ
แสดงสิ่งที่ `record-meeting` log ไว้เท่านั้น

- **ตอนเริ่ม**: เช็คพื้นที่ว่างบน volume เป้าหมาย (เช่น `URLResourceValues`'s
  `volumeAvailableCapacityForImportantUsageKey` หรือ `statfs`) ปฏิเสธไม่ให้
  เริ่มถ้าเหลือน้อยกว่า **2 GB** — พิมพ์ error ลง log แล้ว exit แบบ non-zero
  แทนที่จะเริ่มบันทึกที่มีแนวโน้มจะพื้นที่หมดกลางคัน 2 GB คือ headroom ที่กว้างพอ
  สำหรับเสียง WAV 16-bit/48kHz คู่กันเกินชั่วโมง (ประมาณ 350 MB/ชั่วโมงต่อ track,
  ~700 MB/ชั่วโมงสำหรับทั้งคู่) ในขณะที่ยังเป็นเกณฑ์ที่มนุษย์ทำอะไรได้ทัน
  (เคลียร์พื้นที่) ก่อนที่จะสายเกินไป
- **ระหว่างบันทึก**: เช็คซ้ำตาม timer (ทุกๆ ~15 วินาที ใช้ dispatch loop เดียวกับ
  ที่รันสำหรับเขียน buffer อยู่แล้ว — ไม่ต้องเปิด thread เพิ่ม)
  - เหลือน้อยกว่า **1 GB** (soft threshold): log บรรทัด `WARN` ลง log file
    เดียวกับที่ `toggle.sh` tee output ไว้อยู่แล้ว แล้วบันทึกต่อไป นี่คือ "เตือน"
    ที่มนุษย์ขอไว้ — เห็นได้ใน log โดยไม่ขัดจังหวะการประชุม
  - เหลือน้อยกว่า **200 MB** (hard threshold): หยุดแบบ graceful — เขียน buffer
    ปัจจุบันให้เสร็จ, ปิด `AVAudioFile` ทั้งสองให้เรียบร้อย (ให้ `mic.wav` กับ
    `system.wav` เป็นไฟล์ที่เล่นได้จริงจนถึงจุดนั้น ไม่ใช่ตัดกลาง frame),
    log เหตุผล แล้ว exit ขั้นตอน stop ของ `toggle.sh` ยังรัน `ffmpeg` merge
    ต่อกับเสียงที่มีอยู่บางส่วนได้ตามปกติ
- ทั้งสองพฤติกรรมที่มนุษย์ถามถึงมีครบ: log เตือนที่ soft threshold และการหยุด
  แบบ graceful-with-intact-files จริงที่ hard threshold — ไม่ใช่แค่อย่างใดอย่างหนึ่ง

## Auto-detect meeting apps

**ข้อกำหนดใหม่: เริ่มบันทึกอัตโนมัติเมื่อพบว่า meeting app กำลังรันอยู่
แทนที่จะ manual start/stop เท่านั้น**

**การตัดสินใจ: เป็น V1.1 ไม่ใช่ V1** กลไกนี้แยกเป็นสอง tier ที่ความน่าเชื่อถือ
ต่างกันมาก และมีแค่ tier เดียวที่ง่ายพอจะอยู่ใน V1 แบบ "แค่อัดเสียงพอ":

- **แอป native (Zoom.app, Microsoft Teams.app)**: ตรวจจับได้ถูกและน่าเชื่อถือ
  ผ่าน `NSWorkspace`'s `didLaunchApplicationNotification`/
  `didTerminateApplicationNotification` (แบบ event-driven ไม่ต้อง polling loop)
  หรือเช็ค bundle-ID ครั้งเดียวกับ `NSWorkspace.shared.runningApplications`
  ส่วนนี้เพียงส่วนเดียวจะเป็นของเพิ่มที่เล็กและความเสี่ยงต่ำ
- **Meet ผ่าน browser (รวมถึง Teams/Zoom ผ่าน tab)**: ไม่มี process ให้เฝ้าดู —
  มันคือ tab ในเบราว์เซอร์อะไรก็ตามที่มนุษย์ใช้ วิธีเดียวที่จะตรวจจับได้คือ
  Accessibility-API ตรวจ window/tab title (ต้องขอ permission ของตัวเองอีก)
  หรือ AppleScript เฉพาะเบราว์เซอร์ที่ query URL/title ของ tab ที่เปิดอยู่ ซึ่งพัง
  ได้ทุกครั้งที่เบราว์เซอร์อัปเดต ไม่ generalize ไปถึงเบราว์เซอร์อื่นที่ไม่ได้รองรับ
  และเป็น complexity แบบ "code path แยกต่อแพลตฟอร์ม" ที่โปรเจกต์นี้พยายามเลี่ยง
  มาตลอด
- การส่ง auto-detect ที่ครอบคลุมแอป native ได้จริงแต่พลาด Meet-ผ่าน-browser แบบ
  เงียบๆ จะแย่กว่าไม่มี auto-detect เลย — มนุษย์ที่พึ่งพามันจะรู้ตัวก็ต่อเมื่อ
  Meet call ไม่ถูกบันทึก ซึ่งขัดกับจุดประสงค์หลัก ("จับทั้งสองฝั่งอย่างน่าเชื่อถือ")
  เมื่อความสำคัญที่มนุษย์ระบุไว้คือ "แค่อัดเสียง ให้ง่าย" V1 จึงยังใช้ manual
  start/stop (ความเสี่ยง false-negative เป็นศูนย์ พิสูจน์แล้วผ่าน pattern shortcut
  ของ voice-to-terminal) และ V1.1 เพิ่ม native-app detection (Zoom.app/Teams.app
  ผ่าน `NSWorkspace` notifications) เป็นชิ้นที่ทำได้จริง ส่วนการตรวจจับผ่าน
  browser เป็นปัญหาที่แยกและยากกว่า รอประเมินขนาดและตัดสินใจทีหลัง — อาจจะไม่ทำเลย
  ก็ได้ ถ้า manual-start-สำหรับ-browser-tab กลายเป็นช่องว่างที่ยอมรับได้ถาวร
  เมื่อ native-app auto-start ครอบคลุม use case หลักแล้ว

## สิ่งที่ไม่ทำอย่างชัดเจน

- Transcription (ไม่มี Whisper, ไม่มี ASR, ไม่มีการ parse VTT)
- อัปโหลด cloud หรือเรียก network ใดๆ เลย
- เชื่อมต่อ API ของ Zoom / Meet / Teams แบบใดก็ตาม (ไม่มี webhook, ไม่มี bot-join,
  ไม่มี SDK) — tool นี้ไม่รู้และไม่สนว่าแอปไหนกำลังทำเสียง
- Speaker diarization
- ฟีเจอร์ multi-user / team, access control, retention policy engine (เป็นไฟล์
  ในเครื่องของคนคนเดียวที่เป็นเจ้าของโฟลเดอร์อยู่แล้ว)
- GUI เมนูบาร์ไอคอนเป็น V2 ที่พอเป็นไปได้ ไม่ใช่ V1
- ตรวจจับอัตโนมัติว่า "กำลังอยู่ในประชุม" — ตัดสินแล้วว่าเป็น **V1.1 ไม่ใช่ V1**
  ดูรายละเอียดกลไกและเหตุผลที่ section "Auto-detect meeting apps" ด้านบน

## Milestone แรก ("เสร็จ" สำหรับเวอร์ชันเล็กที่สุดที่ใช้งานได้จริง)

**ตัดสินแล้ว: permission prompt ตอนรันครั้งแรกเป็น UX ที่ยอมรับได้ ไม่ต้องหา
ทางเลี่ยง** การรันครั้งแรกสุดจะเจอ dialog ขอสิทธิ์ไมโครโฟนและ dialog ขอสิทธิ์
Screen Recording ไม่ว่า macOS จะแสดงลำดับไหนก่อน Screen Recording มี quirk
ที่รู้กันของ macOS — บางครั้งแอปต้อง relaunch หนึ่งครั้งหลังได้รับสิทธิ์นั้นครั้งแรก
ก่อนที่การจับเสียงจะเริ่มทำงานได้จริง นี่คือ friction ตอนตั้งค่าครั้งเดียวที่คาดไว้แล้ว
ไม่ใช่ bug ที่ต้องหาทางเลี่ยง: ให้ระบุไว้ชัดเจน (เช่นใน output ตอนรันครั้งแรก และ
ใน README setup section ตอนสร้างจริง) เพื่อไม่ให้มนุษย์แปลกใจ แทนที่จะสร้างอะไร
มาทำให้มันราบรื่นขึ้น

รัน `./toggle.sh` ครั้งเดียว (หรือกด keyboard shortcut ที่ผูกไว้) ก่อนหรือระหว่าง
ประชุม Zoom/Meet/Teams จริง — หรือแค่เปิดเสียงอะไรบางอย่างผ่านลำโพงพร้อมพูดไปด้วย
ก็ทดสอบได้ ไม่ต้องมีประชุมจริง รันอีกครั้ง (หรือกด shortcut อีกครั้ง) เพื่อหยุด
ได้ผลลัพธ์เป็น
`~/Documents/MeetingRecordings/<timestamp>/{mic.wav,system.wav,combined.wav}`
ที่มนุษย์ฟัง `combined.wav` แล้วได้ยินเสียงตัวเองและเสียงอีกฝ่ายชัดเจนทั้งคู่
sync กันพอสมควร (ไม่มี drift เป็นวินาทีในช่วงไม่กี่นาที — ไม่ต้อง sync ระดับ
sample-accurate) ไม่มี transcription ไม่มี UI นอกจาก shortcut กับไฟล์ผลลัพธ์ใน
Finder

## คำถามเปิดที่ต้องให้มนุษย์ตัดสินใจ

ไม่มีคำถามเปิดค้างจากรอบวางแผนแรกแล้ว `combined.wav` (เก็บไว้ เพิ่มเติมจาก
ไฟล์ดิบ), UX ของ permission prompt (ยอมรับตามที่เป็น), การจัดการ disk space
(ดู "Disk space safety" ด้านบน), การกันเสียง output ของตัวเอง (ไม่เกี่ยวข้อง —
ดู แนวทางการจับเสียง), และขอบเขตของ auto-detect (V1.1 ดู "Auto-detect
meeting apps" ด้านบน) ล้วนถูกตัดสินใจแล้วในรอบนี้

ที่ยังเปิดอยู่จริง: ระยะเวลา retention ของไฟล์ (คนละเรื่องกับ disk-space-full
guard ที่ออกแบบไว้แล้ว) — การบันทึกยังสะสมอยู่ใน
`~/Documents/MeetingRecordings/` ตลอดไปโดยไม่มีการลบอัตโนมัติ
