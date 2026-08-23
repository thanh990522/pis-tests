# PIS Tests

Nền tảng theo dõi kết quả kiểm tra theo từng học sinh của lớp PIS.

## Trạng thái hiện tại

- Đã tạo 11 hồ sơ học sinh theo thứ tự A–Z.
- Có màn hình chọn vai trò học sinh/giáo viên; học sinh đăng nhập bằng username và mật khẩu Firebase.
- Đã tạo hồ sơ riêng cho từng học sinh.
- Mỗi hồ sơ có hai tab: `Báo cáo từng bài test` và `Tổng điểm`.
- Kết quả được lưu trên Cloud Firestore và tự động xuất hiện trên dashboard giáo viên.
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
2. Kết quả được ghi vào Cloud Firestore bằng tài khoản Firebase của học sinh.
3. Dashboard giáo viên nhận report theo thời gian thực.

## Lưu ý bảo mật

Firebase Web config trong `assets/firebase.js` là cấu hình phía client. Quyền truy cập dữ liệu được kiểm soát bằng Firebase Authentication và Firestore Security Rules; không lưu mật khẩu trong repository.
