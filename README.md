# PIS Tests

Nền tảng theo dõi kết quả kiểm tra theo từng học sinh của lớp PIS.

## Trạng thái hiện tại

- Đã tạo 11 hồ sơ học sinh theo thứ tự A–Z.
- Có màn hình chọn vai trò học sinh/giáo viên; học sinh mở hồ sơ bằng mã `pis-001` đến `pis-011`.
- Đã tạo hồ sơ riêng cho từng học sinh.
- Mỗi hồ sơ có hai tab: `Báo cáo từng bài test` và `Tổng điểm`.
- Kết quả lưu cục bộ trên trình duyệt, có thể xuất mã nộp bài/file JSON và nhập vào dashboard giáo viên giống `homework-PIS`.
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
  "details": {}
}
```

Các trang bài test được thêm sau có thể ghi kết quả bằng API trình duyệt:

```js
window.PISTracker.recordReport({
  testId: "test-id",
  score: 8,
  maxScore: 10,
  durationSeconds: 900,
  details: {}
});
```

## Cách tracking

1. Học sinh đăng nhập và làm bài trên thiết bị của mình.
2. Kết quả được lưu trong `localStorage` của trình duyệt.
3. Học sinh tạo mã nộp bài hoặc tải file JSON.
4. Giáo viên đăng nhập dashboard và nhập mã/file để cập nhật hồ sơ.

## Lưu ý bảo mật

Đây là cơ chế lớp học cục bộ trên GitHub Pages, tương tự `homework-PIS`; không phải hệ thống đăng nhập có máy chủ. Mã hồ sơ chỉ dùng để nhận diện dữ liệu trên thiết bị và dữ liệu không tự đồng bộ giữa các thiết bị.

Không dùng GitHub Pages tĩnh để lưu mật khẩu hoặc dữ liệu bí mật.
