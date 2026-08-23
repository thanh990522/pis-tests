# PIS Tests

Nền tảng theo dõi kết quả kiểm tra theo từng học sinh của lớp PIS.

## Trạng thái hiện tại

- Đã tạo danh sách học sinh theo thứ tự bảng chữ cái tiếng Việt.
- Đã tạo hồ sơ riêng cho từng học sinh.
- Mỗi hồ sơ có hai tab: `Báo cáo từng bài test` và `Tổng điểm`.
- Danh mục bài test và báo cáo đang để trống để bổ sung ở các giai đoạn sau.
- Đã thêm GitHub Pages workflow để tự động triển khai khi nhánh `main` thay đổi.

## Cấu trúc dữ liệu

- `data/students.json`: danh sách học sinh.
- `data/tests.json`: danh mục bài test.
- `data/reports.json`: kết quả từng lần làm bài.

Mỗi report trong tương lai dùng cấu trúc:

```json
{
  "id": "report-id",
  "studentId": "pis-001",
  "testId": "test-id",
  "score": 8,
  "maxScore": 10,
  "submittedAt": "2026-08-23T10:00:00+07:00",
  "durationSeconds": 900,
  "answers": []
}
```

## Lưu ý triển khai

GitHub Pages là website tĩnh. Trước khi học sinh làm bài thật, cần kết nối dịch vụ xác thực và cơ sở dữ liệu riêng (ví dụ Firebase) để kết quả từ nhiều thiết bị được lưu an toàn và chỉ giáo viên xem được.
