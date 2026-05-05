## Summary

<!-- อธิบายสั้นๆ ว่า PR นี้ทำอะไร ทำไมถึงต้องทำ -->

## Type

- [ ] `feat` — ฟีเจอร์ใหม่
- [ ] `fix` — แก้ bug
- [ ] `refactor` — ปรับโครงสร้าง (behavior ไม่เปลี่ยน)
- [ ] `docs` — เอกสารเท่านั้น
- [ ] `test` — เพิ่ม/แก้ test
- [ ] `chore` — dependency, CI, config

## Pre-Merge Checklist (ch08b)

- [ ] PR ระบุ REQ, CR, BUG, QA, DOC หรือ deploy change
- [ ] ถ้า user-facing → มี SRS/SDD/UAT/RTM ที่เกี่ยวข้องใน PR เดียวกัน
- [ ] UAT มี test case ที่ QA/มนุษย์อ่านแล้วทำตามได้
- [ ] RTM โยง requirement → code → test → PR ได้
- [ ] Diagram เป็น Mermaid ใน markdown ไม่ใช่ภาพแยก
- [ ] ไม่มี generated docs หลุดเข้า source tree
- [ ] ไม่มี secrets (.env, credentials, API keys) ใน commit

## Doc Updates

<!-- ถ้า user-facing change → ต้องระบุว่าแก้ docs อะไรบ้าง -->
<!-- ถ้า refactor/test-only → เขียน "N/A — no behavior change" -->

- [ ] `docs/SRS.md` updated
- [ ] `docs/SDD.md` updated
- [ ] `docs/UAT.md` updated
- [ ] `docs/RTM.md` updated
- [ ] N/A — ไม่มี user-facing change

## Testing

<!-- วิธีทดสอบ PR นี้ -->

```bash
bun test
```

## Related

<!-- Issue, PR, หรือ REQ-ID ที่เกี่ยวข้อง -->

Closes #
